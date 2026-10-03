import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { Blueprint, FileItem, ScaffolderConfig, Structure, Variable } from "../index";

type Origin = "global" | "local";

interface LoadedBlueprint {
    blueprint: Blueprint;
    origin: Origin;
}

type PlanEntry = { kind: "dir"; path: string } | { kind: "file"; path: string; content: string };

// ---------------------------------------------------------------------------
// Case conversion and placeholders
// ---------------------------------------------------------------------------

function splitWords(str: string): string[] {
    return str
        .replace(/[^a-zA-Z0-9\s_-]/g, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[\s_-]+/)
        .filter(Boolean);
}

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function toPascalCase(str: string): string {
    return splitWords(str).map(capitalize).join("");
}

function toCamelCase(str: string): string {
    const [first, ...rest] = splitWords(str);
    return first === undefined ? "" : first.toLowerCase() + rest.map(capitalize).join("");
}

function toKebabCase(str: string): string {
    return splitWords(str).join("-").toLowerCase();
}

function toSnakeCase(str: string): string {
    return splitWords(str).join("_").toLowerCase();
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\.(raw|pascal|camel|kebab|snake)\}/g;

function replacePlaceholders(text: string, values: Record<string, string>): string {
    return text.replace(PLACEHOLDER, (match: string, key: string, form: string) => {
        if (!Object.prototype.hasOwnProperty.call(values, key)) {
            return match;
        }
        const value = values[key];
        switch (form) {
            case "raw":
                return value;
            case "pascal":
                return toPascalCase(value);
            case "camel":
                return toCamelCase(value);
            case "kebab":
                return toKebabCase(value);
            case "snake":
                return toSnakeCase(value);
            default:
                return match;
        }
    });
}

// ---------------------------------------------------------------------------
// Blueprint loading
// ---------------------------------------------------------------------------

function extractBlueprints(config: unknown, origin: Origin, source: string): LoadedBlueprint[] {
    if (!config || typeof config !== "object") {
        return [];
    }
    const cfg = config as Partial<ScaffolderConfig> & { templates?: unknown };
    if (cfg.blueprints === undefined) {
        if (cfg.templates !== undefined) {
            vscode.window.showWarningMessage(`${source}: "templates" was renamed to "blueprints". Please update the config.`);
        }
        return [];
    }
    if (!Array.isArray(cfg.blueprints)) {
        vscode.window.showWarningMessage(`${source}: "blueprints" must be an array.`);
        return [];
    }
    return cfg.blueprints
        .filter((b) => b && typeof b.title === "string" && b.title !== "")
        .map((blueprint) => ({ blueprint, origin }));
}

function clearProjectModuleCache(rootPath: string): void {
    const nodeModules = `${path.sep}node_modules${path.sep}`;
    for (const id of Object.keys(require.cache)) {
        if (id.startsWith(rootPath) && !id.includes(nodeModules)) {
            delete require.cache[id];
        }
    }
}

function getMergedBlueprints(rootPath: string): LoadedBlueprint[] {
    const globalConfig = vscode.workspace.getConfiguration("scaffolder").get<unknown>("defaultConfig");
    const globalBlueprints = extractBlueprints(globalConfig, "global", "scaffolder.defaultConfig");

    let localBlueprints: LoadedBlueprint[] = [];
    const localConfigPath = path.join(rootPath, "scaffolder.config.js");
    if (fs.existsSync(localConfigPath)) {
        try {
            clearProjectModuleCache(rootPath);
            localBlueprints = extractBlueprints(require(localConfigPath), "local", "scaffolder.config.js");
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            vscode.window.showWarningMessage(`Failed to execute local scaffolder.config.js. Error: ${message}`);
        }
    }

    // Same title: the local blueprint replaces the global one.
    const merged = new Map<string, LoadedBlueprint>();
    for (const item of [...globalBlueprints, ...localBlueprints]) {
        merged.set(item.blueprint.title, item);
    }
    return Array.from(merged.values());
}

// ---------------------------------------------------------------------------
// Validation and planning
// ---------------------------------------------------------------------------

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function readVariables(blueprint: Blueprint): Variable[] {
    const raw = blueprint.variables;
    if (raw === undefined) {
        return [];
    }
    if (!Array.isArray(raw)) {
        throw new Error(`"variables" in blueprint "${blueprint.title}" must be an array.`);
    }
    const seen = new Set<string>();
    for (const variable of raw) {
        const key: unknown = variable?.key;
        if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
            throw new Error(
                `Invalid variable key ${JSON.stringify(key)} in blueprint "${blueprint.title}". ` +
                    `Use letters, digits and underscores; the key must not start with a digit.`,
            );
        }
        if (seen.has(key)) {
            throw new Error(`Duplicate variable key "${key}" in blueprint "${blueprint.title}".`);
        }
        seen.add(key);
    }
    return raw;
}

function textOf(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value) && value.every((line) => typeof line === "string")) {
        return value.join("\n");
    }
    return undefined;
}

function listOf<T>(value: T[] | undefined, what: string): T[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error(`"${what}" must be an array.`);
    }
    return value;
}

function resolveName(rawName: unknown, values: Record<string, string>, what: "file" | "folder"): string {
    if (typeof rawName !== "string" || rawName.trim() === "") {
        throw new Error(`A ${what} in the blueprint has no "name".`);
    }
    const name = replacePlaceholders(rawName, values).trim();
    if (name === "" || name === "." || name === ".." || /[\\/]/.test(name)) {
        const hint =
            name === ""
                ? " The value probably has no Latin letters or digits (.pascal, .camel, .kebab and .snake drop other characters)."
                : ' Names must not contain slashes: use "folders" for nesting.';
        throw new Error(`Invalid ${what} name "${rawName}" (resolved to "${name}").${hint}`);
    }
    return name;
}

function resolveContent(file: FileItem, blueprint: Blueprint, values: Record<string, string>): string {
    const snippetName = file.snippet;
    const hasSnippet = snippetName !== undefined;
    const hasContent = file.content !== undefined;

    if (hasSnippet && hasContent) {
        throw new Error(`File "${file.name}" has both "snippet" and "content". Use only one of them.`);
    }

    let raw: string | undefined;
    if (hasSnippet) {
        const snippets = blueprint.snippets ?? {};
        if (!Object.prototype.hasOwnProperty.call(snippets, snippetName)) {
            throw new Error(
                `Snippet "${snippetName}" used by file "${file.name}" is not defined in blueprint "${blueprint.title}".`,
            );
        }
        raw = textOf(snippets[snippetName]);
        if (raw === undefined) {
            throw new Error(`Snippet "${snippetName}" must be a string or an array of strings.`);
        }
    } else if (hasContent) {
        raw = textOf(file.content);
        if (raw === undefined) {
            throw new Error(`"content" of file "${file.name}" must be a string or an array of strings.`);
        }
    }

    return replacePlaceholders(raw ?? "", values).trim();
}

function buildPlan(
    dir: string,
    structure: Structure,
    blueprint: Blueprint,
    values: Record<string, string>,
    plan: PlanEntry[],
): void {
    for (const file of listOf(structure.files, "files")) {
        const name = resolveName(file?.name, values, "file");
        plan.push({ kind: "file", path: path.join(dir, name), content: resolveContent(file, blueprint, values) });
    }
    for (const folder of listOf(structure.folders, "folders")) {
        const name = resolveName(folder?.name, values, "folder");
        const folderPath = path.join(dir, name);
        plan.push({ kind: "dir", path: folderPath });
        buildPlan(folderPath, folder, blueprint, values, plan);
    }
}

function checkPlan(plan: PlanEntry[], rootPath: string): void {
    for (const entry of plan) {
        if (!fs.existsSync(entry.path)) {
            continue;
        }
        const isDir = fs.statSync(entry.path).isDirectory();
        const rel = path.relative(rootPath, entry.path);
        if (entry.kind === "file" && isDir) {
            throw new Error(`"${rel}" already exists and is a folder.`);
        }
        if (entry.kind === "dir" && !isDir) {
            throw new Error(`"${rel}" already exists and is a file.`);
        }
    }
}

function executePlan(plan: PlanEntry[], skipExisting: boolean): { created: number; skipped: number } {
    let created = 0;
    let skipped = 0;
    for (const entry of plan) {
        if (entry.kind === "dir") {
            fs.mkdirSync(entry.path, { recursive: true });
            continue;
        }
        if (skipExisting && fs.existsSync(entry.path)) {
            skipped++;
            continue;
        }
        fs.writeFileSync(entry.path, entry.content, "utf8");
        created++;
    }
    return { created, skipped };
}

// ---------------------------------------------------------------------------
// Target folder
// ---------------------------------------------------------------------------

function folderOf(p: string): string | undefined {
    try {
        return fs.statSync(p).isDirectory() ? p : path.dirname(p);
    } catch {
        return undefined;
    }
}

async function resolveTargetFolder(uri: vscode.Uri | undefined, rootPath: string): Promise<string> {
    if (uri && uri.fsPath) {
        return folderOf(uri.fsPath) ?? rootPath;
    }
    try {
        const oldClipboard = await vscode.env.clipboard.readText();
        await vscode.commands.executeCommand("copyFilePath");
        const selectedPath = await vscode.env.clipboard.readText();
        await vscode.env.clipboard.writeText(oldClipboard);
        if (selectedPath) {
            return folderOf(selectedPath) ?? rootPath;
        }
    } catch {
        // fall through to the workspace root
    }
    return rootPath;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand("scaffolder.run", async (uri?: vscode.Uri) => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage("Please open a workspace folder first!");
            return;
        }
        const rootPath = workspaceFolders[0].uri.fsPath;
        const targetFolder = await resolveTargetFolder(uri, rootPath);

        const blueprints = getMergedBlueprints(rootPath);
        if (blueprints.length === 0) {
            vscode.window.showErrorMessage("No blueprints found in global or local configurations!");
            return;
        }

        const quickPickItems = blueprints.map(({ blueprint, origin }) => {
            const keys = Array.isArray(blueprint.variables)
                ? blueprint.variables.map((v) => v?.key).filter((k): k is string => typeof k === "string")
                : [];
            return {
                label: `${origin === "global" ? "🌐 " : "$(package) "}${blueprint.title}`,
                description: keys.length > 0 ? `$(edit) ${keys.join(", ")}` : "",
                blueprint,
            };
        });

        const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: "Select a blueprint to run...",
            ignoreFocusOut: true,
        });
        if (!selectedItem) {
            return;
        }
        const blueprint = selectedItem.blueprint;

        try {
            const variables = readVariables(blueprint);
            const values: Record<string, string> = {};
            const relativePath = path.relative(rootPath, targetFolder) || "root";

            for (const variable of variables) {
                const question =
                    typeof variable.prompt === "string" && variable.prompt.trim() !== ""
                        ? variable.prompt
                        : `Enter value for [${variable.key}]`;
                const value = await vscode.window.showInputBox({
                    prompt: `${question} (Target: ${relativePath})`,
                    placeHolder: `Value for ${variable.key}...`,
                    ignoreFocusOut: true,
                    validateInput: (input) => (input.trim() === "" ? "A value is required" : undefined),
                });
                if (value === undefined) {
                    return;
                }
                values[variable.key] = value.trim();
            }

            if (!blueprint.structure || typeof blueprint.structure !== "object") {
                throw new Error(`Blueprint "${blueprint.title}" has no "structure".`);
            }
            const plan: PlanEntry[] = [];
            buildPlan(targetFolder, blueprint.structure, blueprint, values, plan);
            if (plan.length === 0) {
                throw new Error(`Blueprint "${blueprint.title}" defines no files or folders.`);
            }
            checkPlan(plan, rootPath);

            const conflicts = plan.filter((e) => e.kind === "file" && fs.existsSync(e.path));
            let skipExisting = false;
            if (conflicts.length > 0) {
                const list = conflicts
                    .slice(0, 5)
                    .map((e) => path.relative(rootPath, e.path))
                    .join(", ");
                const more = conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : "";
                const choice = await vscode.window.showWarningMessage(
                    `Files already exist: ${list}${more}`,
                    { modal: true },
                    "Overwrite",
                    "Skip existing",
                );
                if (!choice) {
                    return;
                }
                skipExisting = choice === "Skip existing";
            }

            const { created, skipped } = executePlan(plan, skipExisting);
            const skippedNote = skipped > 0 ? ` (${skipped} skipped)` : "";
            vscode.window.showInformationMessage(
                `Generated ${created} file(s) from blueprint "${blueprint.title}"${skippedNote}.`,
            );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Generation failed: ${message}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
