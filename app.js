#!/usr/bin/env node

const { Program, Command, LovaClass } = require('lovacli');
const { config, connectUser } = require('./settings/settings.js');

let program = new Program(config);

program.init(true);

connectUser();
// program.init(false).then(async ()=>{
// 	await program.execute('rundefault');
// });