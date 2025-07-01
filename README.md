# abctools

abctools provides utilities for music repositories using the ABC music notation, including a CLI tool to generate .abc files from .raw.abc and .abcconfig files.

## Installation

```sh
npm install -g abctools
```

## Usage

### Export Command

To export .abc files from a source directory to an output directory:

```sh
abctools export <sourceDir> <outDir>
```

- `<sourceDir>`: Directory containing .raw.abc and .abcconfig files
- `<outDir>`: Directory where generated .abc files will be written

#### How it works
- Typically, each folder in `<sourceDir>` contains one `.abcconfig` file.
- `.abcconfig` files only contain ABC directives (commands prefixed by `%%`, such as `%%pagewidth`) and comments (prefixed by `%`, e.g. `% this is a comment`).
- These directives are applied to all `.raw.abc` files in that folder.
- Directives in a parent folder's, for example `.someParent.abcconfig` can be overridden by directives in `.someChild.abcconfig` files in child folders. This allows for hierarchical configuration.
- The export process maintains the folder structure of `<sourceDir>` and mirrors it in `<outDir>`. All generated `.abc` files will be placed in the corresponding subfolders of `<outDir>`.

#### Inputs
- One or more `.raw.abc` files in `<sourceDir>`
- One or more `.abcconfig` files in `<sourceDir>` (merged if multiple, with child folder directives overriding parent ones)

#### Outputs
- `.abc` files generated in `<outDir>`, preserving the directory structure of `<sourceDir>`

Example:

```sh
abctools export src/abc/ dist/abc/
```

### Help

To see available commands:

```sh
abctools --help
```

## Example Repository

See [choro-abc](https://github.com/laurent-yin/choro-abc) for a real-world example of a repository that uses abctools to manage and export ABC music notation files.

## License

MIT