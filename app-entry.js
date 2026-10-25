// Client galleries never load main.js, WebGL, Google Drive or its credentials.
if(new URLSearchParams(location.search).has('project')) {
  await import('./projectes-gallery.js').then(m=>m.startClientGallery()).catch(()=>{
    document.body.textContent='No s’ha pogut obrir la galeria. Torna a carregar la pàgina.';
  });
} else {
  for(const src of ['https://apis.google.com/js/api.js','https://accounts.google.com/gsi/client']) {
    const script=document.createElement('script');script.src=src;script.async=true;document.head.append(script);
  }
  await import('./drive.js');
  await import('./main.js?v=v3-2026102506');
}
