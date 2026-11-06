(function(){
  const button=document.getElementById('legacyExport');
  if(!button)return;
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch(_){return fallback;}};
  const dataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  button.addEventListener('click',async()=>{
    button.disabled=true;button.textContent='正在打包…';
    try{
      const days=readJson('yunnan-trip-plan-v1',{});
      const places=readJson('yunnan-custom-places-v1',[]);
      const picks=readJson('yunnan-poi-selected',[]);
      const assets={trip:{},place:{}};
      for(const [date,day] of Object.entries(days)){
        for(const image of day.screenshots||[]){
          const key=`${date}:${image.id}`;
          try{const blob=await tripAssetRequest('readonly',key);if(blob)assets.trip[key]=await dataUrl(blob);}catch(error){console.warn('截图未打包',key,error);}
        }
      }
      for(const place of places){
        for(const image of place.images||[]){
          const key=`${place.id}:${image.id}`;
          try{const blob=await customPlaceAssetRequest('readonly',key);if(blob)assets.place[key]=await dataUrl(blob);}catch(error){console.warn('地点图片未打包',key,error);}
        }
      }
      const archive={format:'yunnan-trip-archive-v1',exportedAt:new Date().toISOString(),days,places,picks,assets};
      const url=URL.createObjectURL(new Blob([JSON.stringify(archive)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='滇东南旅行旧页面内容.json';document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      button.textContent='已导出';
    }catch(error){console.error(error);button.textContent='导出失败，请重试';}
    finally{button.disabled=false;setTimeout(()=>{button.textContent='导出本机旧内容';},2500);}
  });
})();
