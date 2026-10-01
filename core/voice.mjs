const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

export const GM_VOICE_PROFILES=[
  {id:'gm_calm_male',label:'Спокойный мужской',kind:'gm',providerVoice:{openai:'cedar'},style:{speed:.94,pitch:0,roughness:.08,emotion:'neutral',volume:1,speechPattern:'short_clear'}},
  {id:'gm_hard_male',label:'Жёсткий мужской',kind:'gm',providerVoice:{openai:'onyx'},style:{speed:.92,pitch:-1,roughness:.22,emotion:'controlled',volume:1,speechPattern:'short_clear'}},
  {id:'gm_neutral',label:'Нейтральный',kind:'gm',providerVoice:{openai:'alloy'},style:{speed:1,pitch:0,roughness:.04,emotion:'neutral',volume:1,speechPattern:'short_clear'}},
  {id:'gm_female',label:'Спокойный женский',kind:'gm',providerVoice:{openai:'coral'},style:{speed:.96,pitch:1,roughness:.03,emotion:'neutral',volume:1,speechPattern:'short_clear'}},
  {id:'gm_cinematic',label:'Кинематографичный',kind:'gm',providerVoice:{openai:'ballad'},style:{speed:.88,pitch:-1,roughness:.12,emotion:'restrained_cinematic',volume:1,speechPattern:'measured'}}
];

export const PLAYER_VOICE_PROFILES=[
  ['pc_male_01','Мужской · спокойный','cedar'],['pc_male_02','Мужской · низкий','onyx'],['pc_male_03','Мужской · молодой','echo'],
  ['pc_male_04','Мужской · резкий','ash'],['pc_male_05','Мужской · мягкий','fable'],
  ['pc_female_01','Женский · спокойный','coral'],['pc_female_02','Женский · молодой','nova'],['pc_female_03','Женский · мягкий','shimmer'],
  ['pc_female_04','Женский · уверенный','sage'],['pc_neutral_01','Нейтральный · чистый','alloy'],
  ['pc_neutral_02','Нейтральный · тёмный','ash'],['pc_neutral_03','Нейтральный · кинематографичный','ballad']
].map(([id,label,voice],i)=>({id,label,kind:'player',providerVoice:{openai:voice},style:{speed:[.94,.9,1.02,.98,.96][i%5],pitch:0,roughness:(i%4)*.06,emotion:'character',volume:1,speechPattern:'character'}}));

export const NPC_VOICE_ARCHETYPES=[
  ['npc_old_man','Старый мужчина','onyx',.83,-2,.25],['npc_young_man','Молодой мужчина','echo',1.04,0,.06],
  ['npc_low_rough','Низкий грубый','ash',.9,-2,.35],['npc_nervous','Нервный','echo',1.14,1,.1],
  ['npc_high','Высокий голос','fable',1.05,2,.04],['npc_childlike','Очень молодой','nova',1.08,3,.02],
  ['npc_young_woman','Молодая женщина','nova',1.03,1,.04],['npc_mature_woman','Зрелая женщина','coral',.93,0,.08],
  ['npc_hoarse','Хриплый','onyx',.9,-1,.4],['npc_soldier','Солдатский','cedar',.96,-1,.18],
  ['npc_scientist','Учёный','alloy',.98,0,.03],['npc_merchant','Торговец','fable',1.01,0,.08],
  ['npc_creature','Существо','onyx',.82,-3,.45],['npc_robot','Робот','alloy',.9,0,0],['npc_whisper','Шёпот','shimmer',.78,1,.02]
].map(([id,label,voice,speed,pitch,roughness])=>({id,label,kind:'npc',providerVoice:{openai:voice},style:{speed,pitch,roughness,emotion:'adaptive',volume:1,speechPattern:id==='npc_robot'?'precise':'natural'}}));

export const UNIQUE_VOICE_PROFILES=[
  {id:'unique_void_child',label:'Пустотный ребёнок',kind:'unique',providerVoice:{openai:'nova'},style:{speed:.76,pitch:2,roughness:.02,emotion:'uncanny_calm',volume:.92,speechPattern:'long_pauses'}},
  {id:'unique_clean_undead',label:'Бездыхательная нежить',kind:'unique',providerVoice:{openai:'alloy'},style:{speed:.87,pitch:-1,roughness:0,emotion:'emotionless',volume:1,speechPattern:'no_breath'}},
  {id:'unique_swarm',label:'Разумный рой',kind:'unique',providerVoice:{openai:'ballad'},style:{speed:.92,pitch:-1,roughness:.18,emotion:'polyphonic',volume:1,speechPattern:'layered'}},
  {id:'unique_machine',label:'Машина 0.4',kind:'unique',providerVoice:{openai:'ash'},style:{speed:.86,pitch:-1,roughness:.02,emotion:'flat',volume:1,speechPattern:'pause_0_4'}}
];

const allProfiles=[...GM_VOICE_PROFILES,...PLAYER_VOICE_PROFILES,...NPC_VOICE_ARCHETYPES,...UNIQUE_VOICE_PROFILES];
export const voiceProfile=id=>allProfiles.find(x=>x.id===id)||null;

const hash=s=>{let h=2166136261;for(const ch of String(s||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};

export function assignNpcVoiceProfile(npc,{unique=false,seed=null}={}){
  if(npc?.voiceProfileId&&voiceProfile(npc.voiceProfileId))return npc.voiceProfileId;
  const bank=unique?UNIQUE_VOICE_PROFILES:NPC_VOICE_ARCHETYPES;
  const chosen=bank[hash(seed||npc?.id||npc?.name)%bank.length];
  if(npc)npc.voiceProfileId=chosen.id;
  return chosen.id;
}

export function profileForSpeaker({speakerType='GM',speaker=null,room=null}={}){
  if(speakerType==='GM'||speakerType==='TIMER')return voiceProfile(room?.voice?.gmVoiceId)||GM_VOICE_PROFILES[0];
  if(speakerType==='PLAYER')return voiceProfile(speaker?.voiceProfileId)||PLAYER_VOICE_PROFILES[0];
  if(speakerType==='NPC')return voiceProfile(speaker?.voiceProfileId)||voiceProfile(assignNpcVoiceProfile(speaker))||NPC_VOICE_ARCHETYPES[0];
  return null;
}

export function speechInstructions(profile,event={}){
  if(!profile)return'';
  const s=profile.style||{},bits=[
    'Speak as '+profile.label+'.',
    'Speed '+(s.speed??1)+'.',
    'Pitch impression '+(s.pitch??0)+'.',
    'Roughness '+(s.roughness??0)+'.',
    'Emotion '+(event.emotion||s.emotion||'neutral')+'.',
    'Speech pattern '+(event.speechPattern||s.speechPattern||'natural')+'.'
  ];
  if(profile.kind==='gm')bits.push('Be concise, clear, neutral, and never perform an NPC voice.');
  return bits.join(' ');
}

export function publicVoiceCatalog(){
  return{gm:GM_VOICE_PROFILES.map(({id,label})=>({id,label})),player:PLAYER_VOICE_PROFILES.map(({id,label})=>({id,label})),npcArchetypes:NPC_VOICE_ARCHETYPES.map(({id,label})=>({id,label})),unique:UNIQUE_VOICE_PROFILES.map(({id,label})=>({id,label}))};
}

export function makeVoiceEvent({speakerType='GM',speakerId='GM',type='narration',text='',emotion=null,seconds=null,mechanics=null}={}){
  return{id:'voice_'+Math.random().toString(36).slice(2,10),speakerType,speakerId,type,text:String(text||'').trim(),emotion,seconds:seconds==null?null:clamp(Number(seconds)||0,0,300),mechanics:mechanics||null};
}
