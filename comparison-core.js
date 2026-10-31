/* Cálculos, extração e geração de PDF do protótipo. Sem dependências para gerar arquivos. */
(function(root) {
  'use strict';
  const metrics = [
    ['weight','Peso','kg',['peso atual','peso corporal','peso']],
    ['fat','Gordura corporal','%',['gordura corporal','percentual de gordura','% de gordura','% gordura']],
    ['lean','Massa magra','kg',['massa magra']],
    ['fatMass','Massa gorda','kg',['massa gorda']],
    ['bmi','IMC','kg/m²',['imc']],
    ['waist','Cintura','cm',['cintura']],
    ['abdomen','Abdômen','cm',['abdomen']],
    ['hip','Quadril','cm',['quadril']],
    ['chest','Tórax','cm',['torax braco aberto','torax']],
    ['armRight','Braço direito relaxado','cm',['braco dir. relaxado','braco direito relaxado']],
    ['armLeft','Braço esquerdo relaxado','cm',['braco esq. relaxado','braco esquerdo relaxado']],
    ['thighRight','Coxa direita','cm',['coxa dir.','coxa direita']],
    ['thighLeft','Coxa esquerda','cm',['coxa esq.','coxa esquerda']],
    ['plank','Prancha','s',['prancha']],
    ['situps','Abdominais em 30s','rep.',['abdominal max. em 30s','abdominais em 30s','abdominal em 30s']],
    ['pushups','Flexões em 30s','rep.',['flexao em 30s','flexoes em 30s']],
    ['wells','Banco de Wells (melhor)','cm',['banco de wells (melhor)','melhor resultado']]
  ].map(([id,label,unit,aliases])=>({id,label,unit,aliases}));
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  function number(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const text=String(value).trim().replace(',','.');
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
    const result=Number(text);
    return Number.isFinite(result) ? result : null;
  }
  const format = value => value === null ? 'Não informado' : value.toLocaleString('pt-BR',{maximumFractionDigits:2});
  function compare(previous,current) {
    return metrics.map(metric=>{
      const before=number(previous[metric.id]), after=number(current[metric.id]);
      const delta=before===null||after===null ? null : Math.round((after-before)*100)/100;
      return {...metric,before,after,delta};
    });
  }
  const deltaText = row => row.delta===null ? 'Sem comparação' : (row.delta>0?'+':'')+format(row.delta)+' '+(row.id==='fat'?'p.p.':row.unit);
  const dateText = date => /^\d{4}-\d{2}-\d{2}$/.test(date||'') ? date.split('-').reverse().join('/') : 'Não informada';

  // Agrupa os itens do PDF por linha preservando a posição horizontal de cada coluna.
  function linesFromItems(items) {
    const lines=[];
    for(const item of items.filter(item=>item.str?.trim()).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4])) {
      let line=lines.find(line=>Math.abs(line.y-item.transform[5])<3);
      if(!line){line={y:item.transform[5],items:[]};lines.push(line);}
      line.items.push({text:item.str,x:item.transform[4],width:item.width||0});
    }
    return lines.map(line=>{
      const sorted=line.items.sort((a,b)=>a.x-b.x); let text='';
      const spans=sorted.map(item=>{const start=text.length;text+=item.text+' ';return {...item,start,end:text.length};});
      return {text:text.trim(),spans};
    });
  }
  function linesFromOcr(data,width,height) {
    const scale=595/width,items=[];
    for(const block of data.blocks||[]) for(const paragraph of block.paragraphs||[]) for(const line of paragraph.lines||[]) {
      const words=line.words||[];
      const baseline=line.bbox?.y1 ?? Math.max(0,...words.map(word=>word.bbox.y1));
      for(const word of words)items.push({str:word.text,width:(word.bbox.x1-word.bbox.x0)*scale,
        transform:[1,0,0,1,word.bbox.x0*scale,(height-baseline)*scale]});
    }
    return linesFromItems(items);
  }
  function extract(pages) {
    const values={}, warnings=[]; let name='',date='';
    for(const lines of pages) {
      let comparison=false;
      for(let index=0;index<lines.length;index++) {
        const line=lines[index], text=normalize(line.text);
        if(/comparativo|comparacao com|anterior.*atual/.test(text)) comparison=true;
        if(/dados consolidados|seus resultados|composicao corporal/.test(text)) comparison=false;
        if(comparison) continue;
        const next=lines[index+1];
        if(!name && /^(aluno|nome completo|nome do aluno)\b/.test(text)) {
          name=line.text.replace(/^(Aluno|Nome completo|Nome do aluno)\s*[:|]?\s*/i,'').trim() || next?.text || '';
        }
        if(!name && /relatorio individual/.test(text) && next && !/data|avaliacao/i.test(next.text)) name=next.text.trim();
        if(!date && /data da avaliacao/.test(text)) {
          const match=(line.text+' '+(next?.text||'')).match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
          if(match) date=`${match[3]}-${match[2]}-${match[1]}`;
        }
        for(const metric of metrics) {
          if(values[metric.id]!==undefined) continue;
          let match;
          for(const alias of metric.aliases) {
            const escaped=alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
            const found=new RegExp('(?:^|\\s)('+escaped+')(?![a-z])').exec(text);
            if(found){match={start:found.index+found[0].indexOf(found[1]),end:found.index+found[0].length};break;}
          }
          if(!match) continue;
          const tail=text.slice(match.end).replace(/^\s*\([^)]*\)/,'').replace(/^\s*[:|]\s*/,'');
          // Somente um número imediatamente depois do rótulo; evita capturar outro indicador.
          let value=/^\s*(-?\d+(?:[.,]\d+)?)\b/.exec(tail)?.[1];
          if(value===undefined && next) {
            const anchor=line.spans.find(span=>span.start<=match.start && span.end>match.start);
            const candidate=next.spans.filter(span=>/^\s*-?\d+(?:[.,]\d+)?(?:\s*(?:kg|cm|%|s|rep\.|kg\/m²))?\s*$/.test(span.text))
              .sort((a,b)=>Math.abs(a.x-(anchor?.x||0))-Math.abs(b.x-(anchor?.x||0)))[0];
            if(candidate && anchor && Math.abs(candidate.x-anchor.x)<45) value=candidate.text.match(/-?\d+(?:[.,]\d+)?/)[0];
          }
          const parsed=number(value);
          if(parsed!==null) values[metric.id]=parsed;
        }
      }
    }
    if(!Object.keys(values).length) warnings.push('Nenhum indicador identificado automaticamente. Preencha os valores manualmente.');
    return {values,name,date,warnings};
  }

  // PDF A4 com texto selecionável, fontes padrão e codificação WinAnsi.
  function makePdf({title,name,subtitle='',rows=[],notes='',sources=[],headers=['Indicador','Anterior','Atual','Diferença'],comparison=true}) {
    const special={'€':128,'–':150,'—':151,'‘':145,'’':146,'“':147,'”':148,'•':149,'−':45};
    const hex=text=>Array.from(String(text).normalize('NFC')).map(c=>(special[c]??(c.charCodeAt(0)<=255?c.charCodeAt(0):63)).toString(16).padStart(2,'0')).join('');
    let pages=[],ops=[],y=0;
    const text=(value,x,top,size=12,bold=false,color='0.15 0.17 0.2')=>ops.push(`BT /${bold?'F2':'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x} ${842-top} Tm <${hex(value)}> Tj ET`);
    const line=top=>ops.push(`0.85 0.86 0.88 RG 42 ${842-top} m 553 ${842-top} l S`);
    const wrap=(value,max=87)=>{
      const result=[];
      for(const paragraph of String(value).split('\n')) {
        let current='';
        for(let word of paragraph.split(/\s+/)) {
          while(word.length>max){if(current){result.push(current);current='';}result.push(word.slice(0,max));word=word.slice(max);}
          if(current.length+word.length+1>max){result.push(current);current='';}
          current+=(current?' ':'')+word;
        }
        result.push(current);
      }
      return result;
    };
    const finish=()=>{line(798);text('JOÃO PAULO | TREINADOR',42,815,10);text('Página '+(pages.length+1),500,815,10);pages.push(ops.join('\n'));};
    const newPage=()=>{ops=[];text('JOÃO PAULO',42,45,14,true);text('AVALIAÇÃO FÍSICA',424,45,10);ops.push('0.70 0.06 0.12 RG 2 w 42 780 m 553 780 l S 0.5 w');y=86;};
    const ensure=height=>{if(y+height>775){finish();newPage();}};
    const paragraph=(value,size=12,bold=false)=>{const leading=Math.max(18,Math.ceil(size*1.35));for(const part of wrap(value,Math.floor(91*10/size))){ensure(leading);text(part,42,y,size,bold);y+=leading;}};
    newPage();paragraph(title,24,true);y+=8;paragraph(name||'Aluno não informado',15,true);paragraph(subtitle);y+=8;
    const tableHeader=()=>{ensure(34);headers.forEach((value,i)=>text(value,[42,268,366,458][i],y,11,true));y+=12;line(y);y+=22;};
    tableHeader();
    for(const row of rows){if(y+32>775){finish();newPage();tableHeader();}text(row[0],42,y,11);text(row[1],268,y,11);text(row[2],366,y,11);text(row[3],458,y,11,true);y+=14;line(y);y+=20;}
    y+=12;
    if(notes){paragraph('Observações do avaliador',13,true);paragraph(notes);y+=10;}
    if(comparison){paragraph('Diferença = atual - anterior. Gordura corporal: variação em pontos percentuais (p.p.).');
    paragraph('Valores ausentes não são tratados como zero. A interpretação cabe ao avaliador.');}
    for(const source of sources) paragraph(source,10);
    finish();
    const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
    const kids=[];
    for(const content of pages){const pageId=objects.length,contentId=pageId+1;kids.push(`${pageId} 0 R`);objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);}
    objects[2]=`<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
    let output='%PDF-1.4\n',offsets=[0];
    for(let i=1;i<objects.length;i++){offsets.push(output.length);output+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
    const xref=output.length;
    output+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for(let i=1;i<objects.length;i++)output+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
    output+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(output);
  }
  const demo={name:'Maria Oliveira (exemplo fictício)',previousDate:'2026-08-26',currentDate:'2026-10-26',previous:{weight:72,fat:28,lean:51.84,fatMass:20.16,bmi:26.45,waist:82,abdomen:88,hip:102,chest:94,armRight:29,armLeft:29,thighRight:57,thighLeft:57,plank:40,situps:18,pushups:8,wells:23},current:{weight:69,fat:25,lean:51.75,fatMass:17.25,bmi:25.34,waist:78,abdomen:84,hip:100,chest:93,armRight:29.5,armLeft:29.5,thighRight:56,thighLeft:56,plank:65,situps:23,pushups:12,wells:27}};
  const api={metrics,normalize,number,format,compare,deltaText,dateText,linesFromItems,linesFromOcr,extract,makePdf,demo};
  if(typeof module!=='undefined' && module.exports)module.exports=api; else root.Comparison=api;
})(typeof window==='undefined'?globalThis:window);
