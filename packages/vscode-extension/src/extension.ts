import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { Blueprint, FileItem, BlueprintorConfig, Structure, Variable } from "../index";

type Origin = "global" | "local";

interface LoadedBlueprint {
    blueprint: Blueprint;
    origin: Origin;
}

type PlanEntry = { kind: "dir"; path: string } | { kind: "file"; path: string; content: string };

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

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function normalizeTitle(title: unknown): string | undefined {
    if (typeof title !== "string") {
        return undefined;
    }
    const trimmed = title.trim();
    if (trimmed === "" || CONTROL_CHARS.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}

function extractBlueprints(config: unknown, origin: Origin, source: string): LoadedBlueprint[] {
    if (!config || typeof config !== "object") {
        return [];
    }
    const cfg = config as Partial<BlueprintorConfig> & { templates?: unknown };
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

    const result: LoadedBlueprint[] = [];
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    let ignored = 0;

    for (const item of cfg.blueprints) {
        const title = item && typeof item === "object" ? normalizeTitle(item.title) : undefined;
        if (title === undefined) {
            ignored++;
            continue;
        }
        if (seen.has(title)) {
            duplicates.add(title);
        }
        seen.add(title);
        result.push({ blueprint: { ...item, title }, origin });
    }

    if (ignored > 0) {
        vscode.window.showWarningMessage(
            `${source}: ${ignored} blueprint(s) ignored because "title" is missing, blank or contains control characters.`,
        );
    }
    if (duplicates.size > 0) {
        const list = Array.from(duplicates, (t) => JSON.stringify(t)).join(", ");
        vscode.window.showWarningMessage(`${source}: duplicate blueprint title(s) ${list}. Only the last one of each is used.`);
    }
    return result;
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
    const globalConfig = vscode.workspace.getConfiguration("blueprintor").get<unknown>("defaultConfig");
    const globalBlueprints = extractBlueprints(globalConfig, "global", "blueprintor.defaultConfig");

    let localBlueprints: LoadedBlueprint[] = [];
    const localConfigPath = path.join(rootPath, "blueprintor.config.js");
    if (fs.existsSync(localConfigPath)) {
        try {
            clearProjectModuleCache(rootPath);
            localBlueprints = extractBlueprints(require(localConfigPath), "local", "blueprintor.config.js");
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            vscode.window.showWarningMessage(`Failed to execute local blueprintor.config.js. Error: ${message}`);
        }
    }

    const merged = new Map<string, LoadedBlueprint>();
    for (const item of [...globalBlueprints, ...localBlueprints]) {
        merged.set(item.blueprint.title, item);
    }
    return Array.from(merged.values());
}

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

function checkSnippets(blueprint: Blueprint): void {
    const snippets = blueprint.snippets;
    if (snippets === undefined) {
        return;
    }
    if (typeof snippets !== "object" || snippets === null || Array.isArray(snippets)) {
        throw new Error(`"snippets" in blueprint "${blueprint.title}" must be an object.`);
    }
    for (const name of Object.keys(snippets)) {
        if (!KEY_PATTERN.test(name)) {
            throw new Error(
                `Invalid snippet name ${JSON.stringify(name)} in blueprint "${blueprint.title}". ` +
                    `Use letters, digits and underscores; the name must not start with a digit.`,
            );
        }
    }
}
const CASE_FORMS = {
    pascal: toPascalCase,
    camel: toCamelCase,
    kebab: toKebabCase,
    snake: toSnakeCase,
};

type CaseForm = keyof typeof CASE_FORMS;

const CASE_SAFE_VALUE = /^[A-Za-z0-9\s_-]*$/;

function collectUsedForms(blueprint: Blueprint): Map<string, Set<CaseForm>> {
    const used = new Map<string, Set<CaseForm>>();

    const scan = (value: unknown): void => {
        const text = textOf(value);
        if (text === undefined) {
            return;
        }
        for (const match of text.matchAll(PLACEHOLDER)) {
            const key = match[1];
            const form = match[2];
            if (key === undefined || form === undefined || !(form in CASE_FORMS)) {
                continue;
            }
            const forms = used.get(key) ?? new Set<CaseForm>();
            forms.add(form as CaseForm);
            used.set(key, forms);
        }
    };

    const walk = (node: unknown): void => {
        if (!node || typeof node !== "object") {
            return;
        }
        const { files, folders } = node as Structure;
        if (Array.isArray(files)) {
            for (const file of files) {
                if (!file || typeof file !== "object") {
                    continue;
                }
                scan(file.name);
                scan(file.content);
                const snippets = blueprint.snippets;
                if (
                    typeof file.snippet === "string" &&
                    snippets &&
                    Object.prototype.hasOwnProperty.call(snippets, file.snippet)
                ) {
                    scan(snippets[file.snippet]);
                }
            }
        }
        if (Array.isArray(folders)) {
            for (const folder of folders) {
                if (!folder || typeof folder !== "object") {
                    continue;
                }
                scan(folder.name);
                walk(folder);
            }
        }
    };

    walk(blueprint.structure);
    return used;
}

function checkValue(input: string, forms: Set<CaseForm> | undefined): string | undefined {
    const value = input.trim();
    if (value === "") {
        return "A value is required";
    }
    if (forms === undefined || forms.size === 0) {
        return undefined;
    }
    const list = Array.from(forms, (form) => `.${form}`).join(", ");
    if (!CASE_SAFE_VALUE.test(value)) {
        return `Only Latin letters, digits, spaces, "_" and "-" are allowed: this value is used with ${list}, which would drop other characters.`;
    }
    for (const form of forms) {
        if (CASE_FORMS[form](value) === "") {
            return `The value must contain at least one Latin letter or digit (it is used with ${list}).`;
        }
    }
    return undefined;
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

const FORBIDDEN_NAME_CHARS = /[<>:"|?*\u0000-\u001F]/;
const MAX_NAME_LENGTH = 255;

function nameProblem(name: string): string | undefined {
    if (name === "") {
        return "The name is empty. The value probably has no Latin letters or digits (.pascal, .camel, .kebab and .snake drop other characters).";
    }
    if (name === "." || name === "..") {
        return 'A name cannot be "." or "..".';
    }
    if (/[\\/]/.test(name)) {
        return 'Names must not contain slashes: use "folders" for nesting.';
    }
    if (FORBIDDEN_NAME_CHARS.test(name)) {
        return 'Names must not contain < > : " | ? * or control characters (they are not allowed in file names on Windows).';
    }
    if (name.endsWith(".")) {
        return "Names must not end with a dot (not allowed on Windows).";
    }
    if (name.length > MAX_NAME_LENGTH) {
        return `Names must not be longer than ${MAX_NAME_LENGTH} characters.`;
    }
    return undefined;
}

function resolveName(rawName: unknown, values: Record<string, string>, what: "file" | "folder"): string {
    if (typeof rawName !== "string" || rawName.trim() === "") {
        throw new Error(`A ${what} in the blueprint has no "name".`);
    }
    const name = replacePlaceholders(rawName, values).trim();
    const problem = nameProblem(name);
    if (problem !== undefined) {
        throw new Error(`Invalid ${what} name "${rawName}" (resolved to "${name}"). ${problem}`);
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
    const seen = new Map<string, PlanEntry>();
    for (const entry of plan) {
        const key = entry.path.toLowerCase();
        const previous = seen.get(key);
        if (previous === undefined) {
            seen.set(key, entry);
            continue;
        }
        if (previous.kind === "dir" && entry.kind === "dir" && previous.path === entry.path) {
            continue;
        }
        const rel = path.relative(rootPath, entry.path);
        if (previous.kind !== entry.kind) {
            throw new Error(`"${rel}" is used both as a file and as a folder.`);
        }
        throw new Error(`"${rel}" would be created twice (paths are compared without regard to letter case).`);
    }

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
    } catch {}
    return rootPath;
}

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand("blueprintor.run", async (uri?: vscode.Uri) => {
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
            checkSnippets(blueprint);
            const usedForms = collectUsedForms(blueprint);

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
                    validateInput: (input) => checkValue(input, usedForms.get(variable.key)),
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
