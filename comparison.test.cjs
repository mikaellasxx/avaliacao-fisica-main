const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('./comparison-core.js');
const fs=require('node:fs');
const vm=require('node:vm');
const Reader=require('./comparison-reader.js');

test('compara valores, preserva zero e distingue dados ausentes',()=>{
  const rows=C.compare({weight:'72',fat:'28',plank:'0',waist:''},{weight:'69',fat:'25',plank:'30',waist:'78'});
  const find=id=>rows.find(row=>row.id===id);
  assert.equal(find('weight').delta,-3);
  assert.equal(C.deltaText(find('fat')),'-3 p.p.');
  assert.equal(find('plank').delta,30);
  assert.equal(find('waist').delta,null);
  assert.equal(C.number('0'),0);
  assert.equal(C.number(''),null);
  assert.equal(C.number('12,5'),12.5);
  assert.equal(C.number('NaN'),null);
});

const item=(str,x,y)=>({str,width:str.length*5,transform:[1,0,0,1,x,y]});
test('extrai tabelas simples com identidade e datas sem confundir valores anteriores',()=>{
  const pages=[C.linesFromItems([
    item('Aluno: Maria Oliveira',42,750),item('Data da avaliação: 26/10/2026',42,730),
    item('Peso',42,700),item('69',268,700),item('kg',366,700),
    item('Gordura corporal',42,680),item('25',268,680),item('%',366,680),
    item('Prancha',42,660),item('0',268,660),item('s',366,660),
    item('Comparativo com a avaliação anterior',42,640),
    item('Massa magra',42,620),item('100',268,620),item('51,75',366,620)
  ])];
  const result=C.extract(pages);
  assert.equal(result.name,'Maria Oliveira');
  assert.equal(result.date,'2026-10-26');
  assert.equal(result.values.weight,69);
  assert.equal(result.values.fat,25);
  assert.equal(result.values.plank,0);
  assert.equal(result.values.lean,undefined);
});

test('extrai cartões com colunas de rótulos e resultados abaixo',()=>{
  const pages=[C.linesFromItems([
    item('Peso atual',42,700),item('Gordura corporal',170,700),item('Massa magra',298,700),item('IMC',426,700),
    item('69 kg',42,680),item('25%',170,680),item('51,75 kg',298,680),item('25,34',426,680)
  ])];
  const result=C.extract(pages);
  assert.deepEqual(result.values,{weight:69,fat:25,lean:51.75,bmi:25.34});
});

test('PDF sem indicadores deixa os campos ausentes',()=>{
  assert.deepEqual(C.extract([]).values,{});
  assert.equal(C.extract([]).warnings.length,1);
  assert.deepEqual(C.extract([C.linesFromItems([item('Peso atual —',42,700),item('Gordura corporal 25%',42,680)])]).values,{fat:25});
});

function ocrWord(text,x,y,width=text.length*6){return {text,bbox:{x0:x,y0:y,x1:x+width,y1:y+12}};}
const ocrResult={blocks:[{paragraphs:[{lines:[
  {words:[ocrWord('Peso atual',80,200),ocrWord('Gordura corporal',340,200),ocrWord('Massa magra',600,200),ocrWord('IMC',860,200)]},
  {words:[ocrWord('58,0 kg',80,230),ocrWord('19,3%',340,230),ocrWord('46,8 kg',600,230),ocrWord('20,3',860,230)]}
]}]}]};
test('leitura visual preserva as colunas e extrai os resultados de cartões',()=>{
  const lines=C.linesFromOcr(ocrResult,1190,1684);
  const extracted=C.extract([lines]);
  assert.deepEqual(extracted.values,{weight:58,fat:19.3,lean:46.8,bmi:20.3});
});

test('PDF sem texto aciona OCR, renderiza página e libera recursos',async()=>{
  let workers=0,terminated=0,rendered=0,cleaned=0;const canvases=[];
  const result=await Reader.readPages({numPages:2,getPage:async()=>({
    getTextContent:async()=>({items:[]}),getViewport:()=>({width:1190,height:1684}),
    render:()=>{rendered++;return {promise:Promise.resolve()};},cleanup(){cleaned++;}
  })},{createOcrWorker:async()=>{workers++;return {
    recognize:async(canvas,options,output)=>{assert.equal(output.blocks,true);return {data:ocrResult};},
    terminate:async()=>{terminated++;}
  };},createCanvas:()=>{const canvas={getContext:()=>({})};canvases.push(canvas);return canvas;}});
  assert.equal(result.ocrPages,2);assert.equal(workers,1);assert.equal(terminated,1);
  assert.equal(rendered,2);assert.equal(cleaned,2);assert.equal(canvases[0].width,0);
  assert.equal(C.extract(result.pages).values.weight,58);
});

test('PDF com texto continua lendo sem baixar nem inicializar OCR',async()=>{
  const result=await Reader.readPages({numPages:1,getPage:async()=>({
    getTextContent:async()=>({items:[item('Peso atual 58 kg',42,700)]}),cleanup(){}
  })},{createOcrWorker:()=>{throw Error('OCR desnecessário');},createCanvas:()=>{throw Error('Canvas desnecessário');}});
  assert.equal(result.ocrPages,0);assert.equal(C.extract(result.pages).values.weight,58);
});

test('falha no OCR encerra worker e limpa página e canvas',async()=>{
  let terminated=false,cleaned=false;const canvas={getContext:()=>({})};
  await assert.rejects(()=>Reader.readPages({numPages:1,getPage:async()=>({
    getTextContent:async()=>({items:[]}),getViewport:()=>({width:1190,height:1684}),
    render:()=>({promise:Promise.resolve()}),cleanup(){cleaned=true;}
  })},{createOcrWorker:async()=>({recognize:async()=>{throw Error('Falha de OCR');},terminate:async()=>{terminated=true;}}),createCanvas:()=>canvas}),/Falha de OCR/);
  assert.equal(terminated,true);assert.equal(cleaned,true);assert.equal(canvas.width,0);
});

test('data de impressão não substitui data da avaliação ausente',()=>{
  const lines=C.linesFromItems([item('26/10/2026, 13:42',42,800),item('DATA DA AVALIAÇÃO',42,700),item('Não informada',42,680)]);
  assert.equal(C.extract([lines]).date,'');
});

test('PDFs de exemplo preservam os 17 indicadores e a identificação na extração',()=>{
  for(const side of ['previous','current']) {
    const bytes=C.makePdf({title:'Avaliação física',name:'Aluno: '+C.demo.name,
      subtitle:'Data da avaliação: '+C.dateText(C.demo[side+'Date']),comparison:false,headers:['Indicador','Resultado','Unidade',''],
      rows:C.metrics.map(metric=>[metric.label,C.format(C.demo[side][metric.id]),metric.unit,''])});
    const text=new TextDecoder().decode(bytes);
    // Recupera os operadores de texto do arquivo gerado para exercitar o reconhecimento.
    const items=[...text.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm <([a-f0-9]+)> Tj/g)]
      .map(match=>item(Buffer.from(match[3],'hex').toString('latin1'),Number(match[1]),Number(match[2])));
    const extracted=C.extract([C.linesFromItems(items)]);
    assert.equal(extracted.name,C.demo.name);
    assert.equal(extracted.date,C.demo[side+'Date']);
    assert.deepEqual(extracted.values,C.demo[side]);
  }
});

test('PDF tem offsets válidos, texto com acentos e paginação para observações longas',()=>{
  const bytes=C.makePdf({title:'Comparativo',name:'João',rows:[['Peso','72','69','-3 kg']],notes:'Orientação com acentuação. '.repeat(500)});
  const text=new TextDecoder().decode(bytes);
  assert.ok(text.startsWith('%PDF-1.4'));
  const xref=Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(xref,xref+4),'xref');
  const offsets=text.slice(xref).split('\n').slice(3).filter(line=>/^\d{10} 00000 n/.test(line));
  offsets.forEach((entry,index)=>assert.ok(text.slice(Number(entry.slice(0,10))).startsWith(`${index+1} 0 obj`)));
  assert.ok(Number(text.match(/\/Type \/Pages \/Count (\d+)/)[1])>1);
  assert.match(text,/<4a6fe36f>/); // João em WinAnsi
  for(const match of text.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g))assert.equal(Number(match[1]),match[2].length);
});

test('fluxo do protótipo: exemplo, revisão obrigatória, validações e download real de PDF',async()=>{
  const elements=new Map(),downloads=[];
  class Element {
    constructor(tag){this.tagName=tag.toUpperCase();this.value='';this.checked=false;this.textContent='';this.events={};this.children=[];this.validity={badInput:false};this.classList={toggle(){}};}
    set id(value){this._id=value;elements.set(value,this);} get id(){return this._id;}
    append(...nodes){this.children.push(...nodes);} remove(){} focus(){}
    setAttribute(key,value){this[key]=value;}
    addEventListener(name,fn){this.events[name]=fn;}
    click(){this.events.click?.();}
  }
  const html=fs.readFileSync('comparar.html','utf8');
  for(const match of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){const el=new Element(match[1]);el.id=match[2];}
  const document={getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),body:new Element('body'),
    querySelectorAll:()=>[...elements.values()].filter(el=>['INPUT','TEXTAREA'].includes(el.tagName)&&!el.id.endsWith('File'))};
  const context=vm.createContext({window:{Comparison:C},document,Blob,TextDecoder,Uint8Array,
    URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},setTimeout(){}});
  vm.runInContext(fs.readFileSync('comparison.js','utf8'),context);
  const $=id=>elements.get(id);
  $('demo').click();
  assert.equal($('previous_weight').value,72);
  assert.equal($('compared').textContent,17);
  assert.equal($('delta_weight').textContent,'-3 kg');
  $('download').click();assert.equal(downloads.length,0);assert.match($('message').textContent,/marque/);
  $('reviewed').checked=true;$('download').click();assert.equal(downloads.length,1);
  assert.equal(downloads[0].type,'application/pdf');
  assert.ok(new TextDecoder().decode(await downloads[0].arrayBuffer()).startsWith('%PDF-1.4'));
  $('currentName').value='Outra pessoa';$('download').click();assert.match($('message').textContent,/diferentes/);assert.equal(downloads.length,1);
  $('currentName').value=C.demo.name;$('currentDate').value='2026-01-01';$('download').click();assert.match($('message').textContent,/posterior/);assert.equal(downloads.length,1);
  $('currentDate').value=C.demo.currentDate;$('current_weight').events.input();assert.equal($('reviewed').checked,false);
  $('samplePrevious').click();$('sampleCurrent').click();assert.equal(downloads.length,3);
});
