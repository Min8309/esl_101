import path from 'node:path';

export function assetPath(root, pathname, paths = path) {
  const file = paths.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + paths.sep)) throw Error('Outside server root');
  return file;
}
