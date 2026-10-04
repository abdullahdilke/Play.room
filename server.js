
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const rooms = new Map();

app.use(express.static("public"));
app.get("/health", (_, res) => res.json({ok:true}));

const games = {
  imposter: {
    name:"Who Is The Imposter?",
    categories:["Food","Animals","Objects","Places"],
    words:{
      Food:[["Pizza","🍕"],["Burger","🍔"],["Ice Cream","🍦"],["Watermelon","🍉"],["Popcorn","🍿"]],
      Animals:[["Cat","🐱"],["Dog","🐶"],["Elephant","🐘"],["Lion","🦁"],["Penguin","🐧"]],
      Objects:[["Phone","📱"],["Chair","🪑"],["Table","🪵"],["Clock","🕒"],["Umbrella","☂️"]],
      Places:[["Beach","🏖️"],["School","🏫"],["Airport","✈️"],["Cinema","🎬"],["Library","📚"]]
    }
  },
  twentyQuestions:{name:"20 Questions", categories:["Anything"]},
  charades:{name:"Silent Charades", categories:["Animals","Jobs","Movies","Actions"]},
  categories:{name:"Category Clash", categories:["Food","Animals","Countries","Objects"]},
  majority:{name:"Majority Rules", categories:["Funny","Daily Life","Food","Games"]},
  detective:{name:"The Secret Clue", categories:["Objects","Places","Animals"]},
  wordchain:{name:"Word Chain", categories:["Food","Animals","Objects","Places"]}
};

function send(ws, type, data={}) {
  if (ws.readyState === 1) ws.send(JSON.stringify({type,...data}));
}
function broadcast(room, type, data={}) {
  for (const p of room.players) send(p.ws,type,data);
}
function publicRoom(room) {
  return {code:room.code, host:room.host, game:room.game, category:room.category,
    phase:room.phase, players:room.players.map(p=>({id:p.id,name:p.name})), max:room.max};
}
function update(room){ broadcast(room,"room",publicRoom(room)); }

function uniqueCode(){
  let c; do { c=Math.random().toString(36).slice(2,8).toUpperCase(); } while(rooms.has(c));
  return c;
}

wss.on("connection", ws=>{
  let me=null, room=null;
  send(ws,"hello",{games});

  ws.on("message", raw=>{
    let m; try{m=JSON.parse(raw)}catch{return}
    if(m.type==="create"){
      const name=String(m.name||"Player").trim().slice(0,20)||"Player";
      const code=uniqueCode();
      room={code,host:null,players:[],game:"imposter",category:"Food",phase:"lobby",max:8,round:null};
      const p={id:crypto.randomUUID(),name,ws}; room.players.push(p); room.host=p.id; me=p; rooms.set(code,room);
      send(ws,"joined",{me:p.id}); update(room); return;
    }
    if(m.type==="join"){
      const code=String(m.code||"").trim().toUpperCase(), name=String(m.name||"Player").trim().slice(0,20)||"Player";
      const r=rooms.get(code);
      if(!r) return send(ws,"error",{message:"Room not found."});
      if(r.players.length>=r.max) return send(ws,"error",{message:"Room is full."});
      if(r.phase!=="lobby") return send(ws,"error",{message:"This game has already started."});
      const p={id:crypto.randomUUID(),name,ws}; r.players.push(p); me=p; room=r;
      send(ws,"joined",{me:p.id}); update(r); return;
    }
    if(!room||!me) return;
    if(m.type==="setGame" && me.id===room.host && room.phase==="lobby"){
      if(games[m.game]) room.game=m.game;
      room.category=games[room.game].categories.includes(m.category)?m.category:games[room.game].categories[0];
      update(room); return;
    }
    if(m.type==="start" && me.id===room.host){
      if(room.players.length<2) return send(ws,"error",{message:"At least 2 players are needed."});
      room.phase="playing";
      if(room.game==="imposter"){
        const list=games.imposter.words[room.category]||games.imposter.words.Food;
        const item=list[Math.floor(Math.random()*list.length)];
        const imp=room.players[Math.floor(Math.random()*room.players.length)];
        room.round={word:item[0],emoji:item[1],imposter:imp.id};
        for(const p of room.players) send(p.ws,"secret",{word:p.id===imp.id?null:item[0],emoji:p.id===imp.id?"❓":item[1],imposter:p.id===imp.id});
      }
      update(room); return;
    }
    if(m.type==="vote" && room.phase==="playing"){
      room.votes=room.votes||{}; room.votes[me.id]=m.target;
      if(Object.keys(room.votes).length===room.players.length){
        const counts={}; Object.values(room.votes).forEach(x=>counts[x]=(counts[x]||0)+1);
        let winner=null,max=-1; for(const [id,n] of Object.entries(counts)) if(n>max){max=n;winner=id;}
        const found=winner===room.round?.imposter;
        room.phase="result";
        broadcast(room,"result",{found, voted:room.players.find(p=>p.id===winner)?.name||"Unknown", imposter:room.players.find(p=>p.id===room.round?.imposter)?.name, word:room.round?.word,emoji:room.round?.emoji});
        update(room);
      } else update(room);
    }
    if(m.type==="restart" && me.id===room.host){
      room.phase="lobby"; room.votes={}; room.round=null; update(room);
    }
  });
  ws.on("close",()=>{
    if(!room||!me)return;
    room.players=room.players.filter(p=>p!==me);
    if(!room.players.length){rooms.delete(room.code);return}
    if(room.host===me.id) room.host=room.players[0].id;
    update(room);
  });
});

const port=process.env.PORT||10000;
server.listen(port,"0.0.0.0",()=>console.log("PlayRoom running on "+port));
