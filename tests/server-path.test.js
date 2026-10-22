import test from 'node:test';
import assert from 'node:assert/strict';
import {posix,win32} from 'node:path';
import {assetPath} from '../server-path.mjs';

for (const [name,paths,root] of [['Windows',win32,'C:\\Users\\user\\esl_101'],['Linux',posix,'/workspace/esl_101']]) {
  test(`${name}: serves index and nested assets, rejects traversal and sibling directories`,()=>{
    assert.equal(assetPath(root,'/',paths),paths.join(root,'index.html'));
    assert.equal(assetPath(root,'/src/app.js',paths),paths.join(root,'src','app.js'));
    assert.throws(()=>assetPath(root,'/../secret.txt',paths));
    assert.throws(()=>assetPath(root,'/../esl_101-other/secret.txt',paths));
    if(name==='Windows')assert.throws(()=>assetPath(root,'/..\\secret.txt',paths));
  });
}
