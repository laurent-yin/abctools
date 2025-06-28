#!/usr/bin/env node
import('../dist/assemble.js').then(mod => {
  const [,, source, out] = process.argv;
  if (!source || !out) {
    console.error('Usage: abcbuild <source> <out>');
    process.exit(1);
  }
  mod.build(source, out).catch(e => {
    console.error(e);
    process.exit(1);
  });
});
