#!/usr/bin/env node
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { normalizeName } from "../worker/src/normalize.js";
function parseCsv(text) {
  const rows=[]; let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell="";}else if(c==='\n'){row.push(cell.replace(/\r$/, ""));rows.push(row);row=[];cell="";}else cell+=c;}
  if(quoted)throw Error("CSV has an unclosed quoted field."); if(cell||row.length){row.push(cell.replace(/\r$/, ""));rows.push(row);} return rows.filter(r=>!(r.length===1&&!r[0].trim()));
}
const quote=v=>`'${String(v).replaceAll("'","''")}'`; const fail=m=>{throw Error(m)};
const args=process.argv.slice(2), file=args[0], pos=args.indexOf("--env"), environment=pos>=0?args[pos+1]:"";
if(!file||!["preview","production"].includes(environment))fail("Usage: npm run import -- <private.csv> --env preview|production");
const rows=parseCsv(await readFile(file,"utf8")), header=["party_number","party_name","guest_name"];
if(rows.length<2||rows[0].map(v=>v.trim()).join()!==header.join())fail(`CSV header must be: ${header.join(",")}`);
const parties=new Map(), names=new Set();
for(const [i,raw] of rows.slice(1).entries()){const line=i+2;if(raw.length!==3)fail(`Line ${line}: expected exactly 3 columns.`);const [numText,partyName,guestName]=raw.map(v=>v.trim());if(!/^\d+$/.test(numText)||Number(numText)<1||!partyName||!guestName)fail(`Line ${line}: all fields are required.`);const num=Number(numText), prior=parties.get(num);if(prior&&prior.name!==partyName)fail(`Line ${line}: inconsistent party name.`);const normalized=normalizeName(guestName);if(!normalized||names.has(normalized))fail(`Line ${line}: blank or duplicate normalized guest name.`);names.add(normalized);if(!prior)parties.set(num,{name:partyName,publicId:randomBytes(24).toString("base64url"),guests:[]});parties.get(num).guests.push({name:guestName,normalized});}
if(environment==="production"&&(parties.size!==33||names.size!==63))fail(`Production requires exactly 33 parties and 63 guests; found ${parties.size} and ${names.size}.`);
const now=new Date().toISOString();let sql="PRAGMA foreign_keys=ON;\nBEGIN TRANSACTION;\n";
for(const [num,p] of parties){sql+=`INSERT INTO parties(public_id,party_number,party_name,created_at) VALUES(${quote(p.publicId)},${num},${quote(p.name)},${quote(now)});\n`;p.guests.forEach((g,n)=>sql+=`INSERT INTO guests(party_id,full_name,normalized_name,display_order,created_at) VALUES((SELECT id FROM parties WHERE party_number=${num}),${quote(g.name)},${quote(g.normalized)},${n},${quote(now)});\n`);}
sql+="COMMIT;\n";const dir=await mkdtemp(join(tmpdir(),"rsvp-import-")), path=join(dir,"import.sql");
try{await writeFile(path,sql,{mode:0o600});const base=["wrangler","d1","execute","DB","--env",environment,"--remote"];let result=spawnSync("npx",[...base,"--file",path],{stdio:"inherit"});if(result.status!==0)process.exit(result.status||1);result=spawnSync("npx",[...base,"--command","SELECT (SELECT COUNT(*) FROM parties) AS parties, (SELECT COUNT(*) FROM guests) AS guests;","--json"],{encoding:"utf8"});if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status||1);}const output=JSON.parse(result.stdout);let counts;const find=value=>{if(!value||counts)return;if(Array.isArray(value))value.forEach(find);else if(typeof value==="object"){if(Number.isInteger(value.parties)&&Number.isInteger(value.guests))counts=value;else Object.values(value).forEach(find);}};find(output);if(!counts||counts.parties!==parties.size||counts.guests!==names.size)fail(`Count verification failed; expected ${parties.size}/${names.size}, got ${counts?.parties ?? "unknown"}/${counts?.guests ?? "unknown"}.`);console.log(`Verified ${counts.parties} parties and ${counts.guests} guests.`);}finally{await rm(dir,{recursive:true,force:true});}
