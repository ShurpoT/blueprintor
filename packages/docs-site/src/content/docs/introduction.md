---
title: Introduction
description: What File Scaffolder is and how it works.
---

**File Scaffolder** is a VS Code extension that creates files and folders from templates ("blueprints"). It fits when you regularly create the same thing: a React component with a test and styles, a Python module, a Go package, task notes.

## How it works

1. You describe a blueprint in a config: a title, the values to ask for (variables), the file structure and the texts of the files.
2. In the Explorer you run **Run File Scaffolder...** on the target folder.
3. You pick a blueprint from the list and enter the values it asks for.
4. The extension creates the structure, substituting your input into file names, folder names and content.

## Features

- Nested folders of any depth.
- Any number of prompted values per blueprint (`variables`), each with its own question.
- Placeholders in five forms: `{name.raw}`, `{name.pascal}`, `{name.camel}`, `{name.kebab}`, `{name.snake}`.
- Reusable texts (`snippets`) or inline `content` for every file.
- Blueprints without questions: just omit `variables`.
- Two configuration sources: global (VS Code settings) and local (`scaffolder.config.js`). On a `title` clash, the local one wins.
- Everything is validated before writing, so a mistake in a config never leaves a half-created result.
- A check for existing files: overwrite, skip existing, or cancel.

## Minimal example

```js title="scaffolder.config.js"
module.exports = {
    blueprints: [
        {
            title: "Idea",
            variables: [{ key: "name", prompt: "Idea name" }],
            snippets: {
                idea: `
# {name.pascal}

Notes go here.
`,
            },
            structure: {
                files: [{ name: "{name.kebab}.md", snippet: "idea" }],
            },
        },
    ],
};
```

Entering `my idea` creates `my-idea.md` with the heading `# MyIdea`.

:::note
`.pascal`, `.camel`, `.kebab` and `.snake` understand Latin letters and digits. Other characters (except spaces, `-` and `_`) are removed from the value. `.raw` inserts the value exactly as typed.
:::
