(function(root) {
  'use strict';
  const C=typeof module!=='undefined'&&module.exports ? require('./comparison-core.js') : root.Comparison;
  async function readPages(pdf,{createOcrWorker,createCanvas,onProgress=()=>{},isCurrent=()=>true}) {
    const pages=[];
    let worker,ocrPages=0;
    try {
      for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++) {
        if(!isCurrent())return null;
        const page=await pdf.getPage(pageNumber);
        let canvas;
        try {
          const content=await page.getTextContent();
          let lines=C.linesFromItems(content.items);
          if(!lines.length) {
            onProgress(`Página ${pageNumber}/${pdf.numPages} sem texto pesquisável. Preparando leitura visual (OCR)…`);
            if(!worker)worker=await createOcrWorker();
            if(!isCurrent())return null;
            const viewport=page.getViewport({scale:2.5});
            canvas=createCanvas();canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
            await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;
            onProgress(`Lendo visualmente a página ${pageNumber}/${pdf.numPages}. Aguarde…`);
            const {data}=await worker.recognize(canvas,{}, {text:true,blocks:true});
            lines=C.linesFromOcr(data,canvas.width,canvas.height);
            ocrPages++;
          }
          pages.push(lines);
        } finally {
          if(canvas){canvas.width=0;canvas.height=0;}
          page.cleanup();
        }
      }
      return {pages,ocrPages};
    } finally {
      if(worker)await worker.terminate();
    }
  }
  const api={readPages};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ComparisonReader=api;
})(typeof window==='undefined'?globalThis:window);
