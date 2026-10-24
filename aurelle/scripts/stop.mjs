import {readFile} from 'node:fs/promises';
const control=JSON.parse(await readFile(new URL('../.data/server-control.json',import.meta.url),'utf8'));
const response=await fetch(`http://127.0.0.1:${control.port}/__development/shutdown`,{method:'POST',headers:{Authorization:`Bearer ${control.token}`},signal:AbortSignal.timeout(10000)});
if(!response.ok)throw new Error('The local process did not accept the shutdown request.');
console.log('Aurelle is draining requests and saving its local database.');
