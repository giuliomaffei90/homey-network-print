'use strict';
const { inspect } = require('../lib/ipp');
const uri=process.argv[2];
if(!uri) { console.error('Uso: npm run probe -- ipp://192.168.1.100/ipp/print [--allow-self-signed]');process.exit(1); }
inspect(uri,{allowSelfSigned:process.argv.includes('--allow-self-signed')}).then(info=>console.log(JSON.stringify({...info,attributes:undefined,paper:info.attributes['media-supported'],scaling:info.attributes['print-scaling-supported']},null,2))).catch(err=>{console.error(err.message);process.exitCode=1;});
