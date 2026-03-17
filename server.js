const express = require("express")
const fs = require("fs")
const path = require("path")

const app = express()
const PORT = process.env.PORT || 10000

app.use(express.json())
app.use(express.static("public"))

const DATA_FILE = path.join(__dirname,"data.json")

function defaultData(){

return{

sectors:{
A:{code:"A",name:"Sektor A",visible:true},
B:{code:"B",name:"Sektor B",visible:true},
C:{code:"C",name:"Sektor C",visible:true},
D:{code:"D",name:"Sektor D",visible:true},
E:{code:"E",name:"Sektor E",visible:false},
F:{code:"F",name:"Sektor F",visible:false},
G:{code:"G",name:"Sektor G",visible:false},
H:{code:"H",name:"Sektor H",visible:false}
},

teams:Array.from({length:50},(_,i)=>({

id:i+1,
name:`Tím ${i+1}`,
sector:["A","B","C","D","E","F","G","H"][Math.floor(i/6)] || "A",
peg:String(i+1),
active:i<20,
photo:null

})),

catches:[]

}

}

function loadData(){

if(!fs.existsSync(DATA_FILE)){

const data=defaultData()
fs.writeFileSync(DATA_FILE,JSON.stringify(data,null,2))
return data

}

return JSON.parse(fs.readFileSync(DATA_FILE))

}

function saveData(data){

fs.writeFileSync(DATA_FILE,JSON.stringify(data,null,2))

}

function buildState(data){

const teams=data.teams.filter(t=>t.active)

let stats={}
let teamCatches={}

teams.forEach(t=>{

stats[t.id]={

id:t.id,
name:t.name,
sector:t.sector,
sectorCode:t.sector,
peg:t.peg,
photo:t.photo,
total:0,
count:0,
biggest:0,
top3:[],
top3sum:0

}

})

data.catches.forEach(c=>{

if(!stats[c.teamId]) return

stats[c.teamId].total+=Number(c.weight)
stats[c.teamId].count+=1

if(Number(c.weight)>stats[c.teamId].biggest){

stats[c.teamId].biggest=Number(c.weight)

}

if(!teamCatches[c.teamId]) teamCatches[c.teamId]=[]

teamCatches[c.teamId].push(c)

})

Object.keys(teamCatches).forEach(id=>{

const sorted=teamCatches[id].sort((a,b)=>b.weight-a.weight)

const top3=sorted.slice(0,3).map(c=>Number(c.weight))

stats[id].top3=top3
stats[id].top3sum=top3.reduce((a,b)=>a+b,0)

})

const leaderboard=Object.values(stats).sort((a,b)=>b.total-a.total)

const top3teams=[...Object.values(stats)].sort((a,b)=>b.top3sum-a.top3sum)

let totalWeight=0
let totalFish=0
let topFish=null

data.catches.forEach(c=>{

totalWeight+=Number(c.weight)
totalFish+=1

if(!topFish || Number(c.weight)>topFish.weight){

const team=data.teams.find(t=>t.id==c.teamId)

topFish={

weight:Number(c.weight),
team:team?team.name:"?"

}

}

})

return{

lb:leaderboard,
teamCatches,
top3teams,
totalWeight,
totalFish,
topFish

}

}

app.get("/api/state",(req,res)=>{

const data=loadData()
res.json(buildState(data))

})

app.get("/api/sectors",(req,res)=>{

const data=loadData()

res.json(Object.values(data.sectors).filter(s=>s.visible))

})

app.get("/api/admin/setup",(req,res)=>{

res.json(loadData())

})

app.post("/api/admin/setup",(req,res)=>{

const data=req.body
saveData(data)

res.json({ok:true})

})

app.post("/api/catch",(req,res)=>{

const data=loadData()

data.catches.push({

teamId:Number(req.body.teamId),
weight:Number(req.body.weight),
time:new Date().toISOString()

})

saveData(data)

res.json({ok:true})

})

app.listen(PORT,()=>{

console.log("RCC server running",PORT)

})