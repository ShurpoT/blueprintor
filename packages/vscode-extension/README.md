# Blueprintor

Create files and folders from your own templates in VS Code, with one command.

Describe a structure once (folders, files, texts), then generate it by typing a name. A React component with styles and a test, a Python module, a Go package, a SQL migration: anything you create again and again.

## Features

- Nested folders and any number of files per blueprint.
- Any number of prompted values, each with its own question.
- Placeholders in file names, folder names and content: `{name.pascal}`, `{name.camel}`, `{name.kebab}`, `{name.snake}`, `{name.raw}`.
- Reusable texts (snippets) or inline content for every file.
- Global blueprints (VS Code settings) and project blueprints (`blueprintor.config.js`). On the same title, the project one wins.
- Everything is validated before writing, so a mistake in a config never leaves a half-created result.
- Existing files are never overwritten without asking.

## Quick start

1. Create `blueprintor.config.js` in the root of your workspace:

```js
module.exports = {
    blueprints: [
        {
            title: "React component",
            variables: [{ key: "name", prompt: "Component name" }],
            snippets: {
                component: `
export function {name.pascal}() {
  return <div />;
}
`,
                index: `
export * from './{name.pascal}';
`,
            },
            structure: {
                folders: [
                    {
                        name: "{name.pascal}",
                        files: [
                            { name: "{name.pascal}.tsx", snippet: "component" },
                            { name: "index.ts", snippet: "index" },
                        ],
                    },
                ],
            },
        },
    ],
};
```

2. Right-click a folder in the Explorer and choose **Run Blueprintor...** (you can also use the button in the Explorer title or the Command Palette).
3. Pick the blueprint and enter `button`. The result:

```
src/components/
└── Button/
    ├── Button.tsx
    └── index.ts
```

## Placeholders

For every variable there are five forms. For the input `my idea`:

| Placeholder     | Result    |
| --------------- | --------- |
| `{name.raw}`    | `my idea` |
| `{name.pascal}` | `MyIdea`  |
| `{name.camel}`  | `myIdea`  |
| `{name.kebab}`  | `my-idea` |
| `{name.snake}`  | `my_idea` |

## Global blueprints

Blueprints for every project go into the `blueprintor.defaultConfig` setting. In JSON there are no multi-line strings, so texts are written as arrays of lines:

```json
{
    "blueprintor.defaultConfig": {
        "blueprints": [
            {
                "title": "Markdown note",
                "variables": [{ "key": "name", "prompt": "Note title" }],
                "snippets": { "note": ["# {name.raw}", "", "Write here."] },
                "structure": { "files": [{ "name": "{name.kebab}.md", "snippet": "note" }] }
            }
        ]
    }
}
```

## Requirements and security

- VS Code 1.103.0 or newer and an open workspace folder.
- `blueprintor.config.js` is JavaScript that runs when you start the command. For this reason the extension is disabled in untrusted workspaces (Restricted Mode). Review the file before trusting a repository.

## Documentation

Full documentation with the field reference and examples for React, Python, Go, C++, C# and SQL: https://shurpot.github.io/blueprintor/

## Feedback

Found a bug or have an idea? Open an issue: https://github.com/ShurpoT/blueprintor/issues

## License

[MIT](LICENSE)
