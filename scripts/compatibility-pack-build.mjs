import path from 'node:path';

// Wine's generated Makefile keeps the source reference used to invoke configure.
// strmbase embeds it through __FILE__ even after --strip-debug. Keep the same
// relative reference as the validated payload, regardless of the temporary root.
export function compatibilityPackConfigure(build, source) {
  const relative = path.relative(build, source);
  if (path.isAbsolute(relative) || !relative) throw Error('Compatibility source must be separate from the build directory.');
  return path.join(relative, 'configure');
}
