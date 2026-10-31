(function() {
  'use strict';
  const C=window.Comparison;
  const $=id=>document.getElementById(id);
  const versions={previous:0,current:0};
  const sources={previous:'Preenchimento manual',current:'Preenchimento manual'};
  let library;
  let ocrLibrary;
  let busy=0;
  for(const metric of C.metrics) {
    const row=document.createElement('tr');
    const label=document.createElement('th');label.scope='row';label.textContent=`${metric.label} (${metric.unit})`;row.append(label);
    for(const side of ['previous','current']) {
      const cell=document.createElement('td'),input=document.createElement('input');
      input.type='number';input.step='any';input.id=`${side}_${metric.id}`;
      input.setAttribute('aria-label',`${metric.label}, avaliação ${side==='previous'?'anterior':'atual'}, ${metric.unit}`);
      cell.append(input);row.append(cell);
    }
    const difference=document.createElement('td');difference.id='delta_'+metric.id;difference.className='difference';row.append(difference);
    $('metricRows').append(row);
  }
  function values(side){return Object.fromEntries(C.metrics.map(metric=>[metric.id,$(`${side}_${metric.id}`).value]));}
  function refresh() {
    const rows=C.compare(values('previous'),values('current'));
    rows.forEach(row=>$('delta_'+row.id).textContent=C.deltaText(row));
    const paired=rows.filter(row=>row.delta!==null);
    $('compared').textContent=paired.length;
    $('changed').textContent=paired.filter(row=>row.delta!==0).length;
    $('stable').textContent=paired.filter(row=>row.delta===0).length;
  }
  function fill(side,data={}) {
    C.metrics.forEach(metric=>$(`${side}_${metric.id}`).value=data[metric.id]??'');
    $('reviewed').checked=false;refresh();
  }
  function status(side,text,error=false){$(side+'Status').textContent=text;$(side+'Status').classList.toggle('error',error);}
  function download(bytes,name) {
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function pdfLibrary() {
    if(!library) library=import('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.min.mjs').then(pdfjs=>{
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs';return pdfjs;
    }).catch(error=>{library=null;throw error;});
    return library;
  }
  async function loadOcr() {
    if(window.Tesseract)return window.Tesseract;
    if(!ocrLibrary)ocrLibrary=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
      script.onload=()=>window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Leitor visual indisponível.'));
      script.onerror=()=>{script.remove();reject(new Error('Não foi possível carregar a leitura visual. Verifique sua conexão e selecione o PDF novamente.'));};
      document.head.append(script);
    }).catch(error=>{ocrLibrary=null;throw error;});
    return ocrLibrary;
  }
  for(const side of ['previous','current']) $(side+'File').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    const version=++versions[side];let task,pdf;
    busy++;$('download').disabled=true;
    fill(side);$(side+'Name').value='';$(side+'Date').value='';$(side+'Text').textContent='Lendo…';
    sources[side]='Arquivo: '+file.name;
    status(side,'Lendo '+file.name+'…');$('message').textContent='';
    try {
      if(file.size>20*1024*1024)throw new Error('Use um PDF de até 20 MB.');
      const data=new Uint8Array(await file.arrayBuffer());
      if(!new TextDecoder().decode(data.slice(0,1024)).includes('%PDF-'))throw new Error('O arquivo selecionado não é um PDF válido.');
      let pdfjs;
      try{pdfjs=await pdfLibrary();}catch{throw new Error('Não foi possível carregar o leitor de PDF. Verifique a internet ou preencha os valores manualmente.');}
      task=pdfjs.getDocument({data,isEvalSupported:false,enableXfa:false,useSystemFonts:true});
      pdf=await task.promise;
      if(pdf.numPages>40)throw new Error('Use um PDF de até 40 páginas neste protótipo.');
      const reading=await window.ComparisonReader.readPages(pdf,{
        createCanvas:()=>document.createElement('canvas'),isCurrent:()=>version===versions[side],
        onProgress:text=>{if(version===versions[side])status(side,text);},
        createOcrWorker:async()=>{
          const Tesseract=await loadOcr();
          const worker=await Tesseract.createWorker('por',1,{
            workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
            corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
            logger:progress=>{if(version===versions[side] && progress.status==='recognizing text')status(side,`Reconhecimento visual em andamento: ${Math.round(progress.progress*100)}% da página. Aguarde…`);}
          });
          try{await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});}
          catch(error){await worker.terminate();throw error;}
          return worker;
        }
      });
      if(version!==versions[side])return;
      const {pages,ocrPages}=reading;
      const extracted=C.extract(pages);
      fill(side,extracted.values);$(side+'Name').value=extracted.name;$(side+'Date').value=extracted.date;
      $(side+'Text').textContent=pages.map((lines,i)=>`Página ${i+1}\n`+lines.map(line=>line.text).join('\n')).join('\n\n');
      const count=Object.keys(extracted.values).length;
      if(ocrPages)sources[side]+=' (leitura visual por OCR)';
      const hasText=pages.some(lines=>lines.length);
      status(side,count?`${file.name} • ${count} indicadores encontrados${ocrPages?' por leitura visual (OCR)':''}. Confira os valores${!extracted.date?' e preencha a data da avaliação':''}.`:
        hasText?'O texto foi lido, mas os indicadores não foram reconhecidos. Consulte “Texto identificado no PDF” e preencha os valores.':'A leitura visual não encontrou texto legível. Use uma cópia com melhor qualidade ou preencha os valores.',!count);
    } catch(error) {
      if(version!==versions[side])return;
      const message=error.name==='PasswordException'?'O PDF está protegido por senha. Use uma cópia desbloqueada.':error.message;
      status(side,message||'Não foi possível ler o PDF. Preencha os valores manualmente.',true);
      $(side+'Text').textContent='Leitura não concluída. Os dados anteriores deste campo foram limpos.';
    } finally {
      try {if(pdf)await pdf.destroy();else if(task)await task.destroy();}catch{}
      busy--;$('download').disabled=busy>0;
    }
  });
  document.querySelectorAll('input:not([type=file]),textarea').forEach(input=>input.addEventListener('input',()=>{
    if(input.id!=='reviewed')$('reviewed').checked=false;
    $('message').textContent='';refresh();
  }));
  $('demo').addEventListener('click',()=>{
    for(const side of ['previous','current']){
      versions[side]++;$(side+'File').value='';fill(side,C.demo[side]);
      $(side+'Name').value=C.demo.name;$(side+'Date').value=C.demo[side+'Date'];
      sources[side]='Exemplo fictício';status(side,'Exemplo fictício carregado. Você pode alterar os valores ou baixar os PDFs de exemplo.');
      $(side+'Text').textContent='Dados de demonstração, sem arquivo importado.';
    }
    $('notes').value='Dados fictícios para testar a comparação. A interpretação das mudanças depende do objetivo do aluno.';
    $('message').textContent='Exemplo carregado. Confira os valores e marque a confirmação antes de baixar o comparativo.';refresh();
  });
  function sample(side) {
    const bytes=C.makePdf({title:'Avaliação física • Exemplo fictício',name:'Aluno: '+C.demo.name,
      subtitle:'Data da avaliação: '+C.dateText(C.demo[side+'Date']),
      headers:['Indicador','Resultado','Unidade',''],comparison:false,
      rows:C.metrics.map(metric=>[metric.label,C.format(C.demo[side][metric.id]),metric.unit,'']),
      notes:'Documento com dados fictícios para testar o protótipo.'});
    download(bytes,`avaliacao_${side==='previous'?'anterior':'atual'}_exemplo.pdf`);
  }
  $('samplePrevious').addEventListener('click',()=>sample('previous'));
  $('sampleCurrent').addEventListener('click',()=>sample('current'));
  $('download').addEventListener('click',()=>{
    const message=$('message');
    const previousName=$('previousName').value.trim(), currentName=$('currentName').value.trim();
    if(!previousName||!currentName){message.textContent='Preencha o nome do aluno nas duas avaliações.';return;}
    if(C.normalize(previousName)!==C.normalize(currentName)){message.textContent='Os nomes dos alunos são diferentes. Confira os PDFs e corrija os nomes antes de comparar.';return;}
    const previousDate=$('previousDate').value,currentDate=$('currentDate').value;
    if(!previousDate||!currentDate){message.textContent='Preencha as datas das duas avaliações.';return;}
    if(currentDate<=previousDate){message.textContent='A data atual precisa ser posterior à data da avaliação anterior.';return;}
    const rows=C.compare(values('previous'),values('current'));
    if(!rows.some(row=>row.delta!==null)){message.textContent='Preencha pelo menos um indicador nas duas avaliações para comparar.';return;}
    for(const side of ['previous','current']) for(const metric of C.metrics){
      const input=$(`${side}_${metric.id}`);
      if(input.validity.badInput || (input.value!=='' && C.number(input.value)===null)){message.textContent='Corrija o valor de '+metric.label+'.';input.focus();return;}
    }
    if(!$('reviewed').checked){message.textContent='Confira os dados e marque a confirmação antes de gerar o relatório.';$('reviewed').focus();return;}
    const paired=rows.filter(row=>row.delta!==null),changed=paired.filter(row=>row.delta!==0);
    const bytes=C.makePdf({title:'Comparativo de avaliações',name:currentName,
      subtitle:`${C.dateText(previousDate)} a ${C.dateText(currentDate)} | ${paired.length} indicadores comparáveis; ${changed.length} com mudança.`,
      rows:rows.filter(row=>row.before!==null||row.after!==null).map(row=>[
        `${row.label} (${row.unit})`,C.format(row.before),C.format(row.after),C.deltaText(row)
      ]),notes:$('notes').value.trim(),sources:[`Avaliação anterior: ${sources.previous}`,`Avaliação atual: ${sources.current}`,'Valores conferidos pelo usuário antes da geração.']});
    const safeName=currentName.replace(/[<>:"/\\|?*]/g,'').replace(/\s+/g,'_').slice(0,80);
    download(bytes,`Comparativo_${safeName}_${currentDate}.pdf`);
    message.textContent='PDF comparativo gerado. Veja os downloads do navegador.';
  });
  refresh();
})();
