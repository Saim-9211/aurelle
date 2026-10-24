import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,process.cwd());
const files=parsed.fileNames.map(f=>path.resolve(f));
const host={getScriptFileNames:()=>files,getScriptVersion:()=> '0',getScriptSnapshot:file=>{const text=ts.sys.readFile(file);return text===undefined?undefined:ts.ScriptSnapshot.fromString(text);},getCurrentDirectory:()=>process.cwd(),getCompilationSettings:()=>parsed.options,getDefaultLibFileName:options=>ts.getDefaultLibFilePath(options),fileExists:ts.sys.fileExists,readFile:ts.sys.readFile,readDirectory:ts.sys.readDirectory};
const service=ts.createLanguageService(host);
for(const file of files.filter(f=>f.includes(path.sep+'src'+path.sep))){
  const edits=service.organizeImports({type:'file',fileName:file},{},{})[0];
  if(!edits)continue;
  let text=fs.readFileSync(file,'utf8');
  for(const change of edits.textChanges.toSorted((a,b)=>b.span.start-a.span.start))text=text.slice(0,change.span.start)+change.newText+text.slice(change.span.start+change.span.length);
  fs.writeFileSync(file,text);
}
console.log('Organized source imports.');
