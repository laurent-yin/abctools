#!/usr/bin/env node
import('../dist/assemble.js').then(mod => {
  const [,, cmd, ...args] = process.argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log('Usage: abctools <command> [options]');
    console.log('Commands:');
    console.log('  export <sourceDir> <outDir>   Export .abc files from a source directory to an output directory');
    console.log('\nArguments:');
    console.log('  <sourceDir>   Directory containing .raw.abc and .abcconfig files');
    console.log('  <outDir>      Directory where generated .abc files will be written');
    console.log('\nInputs:');
    console.log('  - One or more .raw.abc files in <sourceDir>');
    console.log('  - Typically, each folder contains one .abcconfig file.');
    console.log('  - .abcconfig files only contain ABC directives (commands prefixed by %% such as %%pagewidth) and comments (prefixed by %, e.g. % this is a comment).');
    console.log('  - Directives in .abcconfig files in child folders override those in parent folders.');
    console.log('\nOutputs:');
    console.log('  - .abc files generated in <outDir>');
    console.log('  - The folder structure of <sourceDir> is mirrored in <outDir>');
    process.exit(0);
  }
  if (cmd === 'export') {
    const [source, out] = args;
    if (!source || !out) {
      console.error('Usage: abctools export <sourceDir> <outDir>');
      process.exit(1);
    }
    mod.build(source, out).catch(e => {
      console.error(e);
      process.exit(1);
    });
  } else {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }
});
