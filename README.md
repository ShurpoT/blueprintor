# Blueprintor

Create files and folders from your own templates in VS Code, with one command.

- Documentation: https://shurpot.github.io/blueprintor/
- Extension: [`packages/vscode-extension`](packages/vscode-extension)
- Docs site (Astro Starlight): [`packages/docs-site`](packages/docs-site)

## Development

```sh
npm install
npm run dev:docs      # docs site with live reload
npm run dev:ext       # compile the extension in watch mode (press F5 in packages/vscode-extension to debug)
npm run package:ext   # build a .vsix file
```

## License

[MIT](LICENSE)
