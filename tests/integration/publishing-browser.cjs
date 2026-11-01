/* Read-only browser checks shared by local project-prefix HTTP and real Pages. */
const fs=require('fs'),assert=require('assert/strict');
const [base,expectedFile,out,mode,playwrightPath,chrome]=process.argv.slice(2);
const {registry,views}=JSON.parse(fs.readFileSync(expectedFile));
const {chromium}=require(playwrightPath);
(async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const page=await context.newPage(),checks=[],requests=[],responses=[],blocked=[],failures=[],errors=[],headerReads=[];
 const check=(name,value)=>{assert(value,name);checks.push(name);};
 context.on('request',request=>{const item={url:request.url(),type:request.resourceType()};requests.push(item);headerReads.push(request.allHeaders().then(h=>{item.has_authorization=Boolean(h.authorization);item.has_cookie=Boolean(h.cookie);}));});
 context.on('response',response=>responses.push({url:response.url(),status:response.status()}));
 context.on('requestfailed',request=>failures.push({url:request.url(),error:request.failure()?.errorText}));
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>{const url=route.request().url();if(!url.startsWith(base)||/\/api(?:\/|$)/.test(new URL(url).pathname)){blocked.push(url);return route.abort();}return route.continue();});
 const noOverflow=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
 const sinceReady=async()=>{await page.locator('.home-page').waitFor();await page.locator('.recent-theme').first().waitFor({state:'attached'});};
 const assets=async()=>{
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));});
  check('Since displayed icons all load',await page.locator('img').evaluateAll(images=>images.length>0&&images.every(image=>image.complete&&image.naturalWidth>0)));
  check('Since Chinese font loads',await page.evaluate(()=>[...document.fonts].some(font=>font.family.includes('Noto')&&font.status==='loaded')));
 };
 try{
  await page.goto(base);
  await page.locator('a[href$="since/"]').first().waitFor();
  for(const site of registry.sites){
   const link=page.locator(`a[href$="${site.path}"]`).first();
   check('portal registered link '+site.id,await link.count()===1&&(await link.innerText()).includes(site.title));
   check('portal link stays under project '+site.id,new URL(await link.getAttribute('href'),base).href===base+site.path);
  }
  check('desktop portal fits viewport',await noOverflow());
  await page.screenshot({path:out+'/'+mode+'-portal-desktop.png',fullPage:true});
  await page.locator('a[href$="since/"]').first().click();await sinceReady();await assets();
  check('root entry opens Since under project prefix',page.url().startsWith(base+'since/'));
  check('Since displays exactly two approved topics',await page.locator('.recent-theme').count()===2);
  check('desktop Since fits viewport',await noOverflow());
  await page.screenshot({path:out+'/'+mode+'-since-desktop.png',fullPage:true});
  for(const [id,view] of Object.entries(views)){
   await page.goto(base+'since/#theme='+id);await page.locator('.timeline-row').first().waitFor();await page.waitForLoadState('networkidle');
   await page.reload();await page.locator('.timeline-row').first().waitFor();
   check(id+' direct hash refresh correct',(await page.locator('.detail-heading h1').innerText())===view.theme.title);
   check(id+' all saved nodes present',await page.locator('.timeline-row').count()===view.nodes.length);
   for(const node of view.nodes){
    await page.locator(`[data-node-id="${node.id}"] .timeline-card`).click();await page.locator('.evidence-panel h2').filter({hasText:node.title}).waitFor();
    for(const sourceId of node.source_ids){
     const source=view.sources.find(s=>s.id===sourceId),card=page.locator(`.evidence-panel [data-source-id="${sourceId}"]`);
     check(id+'/'+node.id+' source '+sourceId,await card.locator('blockquote').innerText()===source.quote);
     check(id+'/'+node.id+' fixed archive '+sourceId,(await card.locator('a').last().getAttribute('href')).includes(source.archive_ref.commit));
    }
   }
   await page.getByRole('button',{name:'原稿',exact:true}).first().click();await page.locator('#full-markdown').waitFor();
   for(const source of view.sources)check(id+' full original source '+source.id,await page.locator(`#full-markdown [data-source-id="${source.id}"] blockquote`).innerText()===source.quote);
   await page.locator('#full-markdown').getByRole('button',{name:'收起',exact:true}).click();await assets();
   await page.screenshot({path:out+'/'+mode+'-'+id+'.png',fullPage:true});
  }
  const first=Object.keys(views).sort()[0];await page.locator('.recent-theme').filter({hasText:views[first].theme.title}).click();
  check('sidebar switches saved topic',(await page.locator('.detail-heading h1').innerText())===views[first].theme.title);
  await page.setViewportSize({width:390,height:844});await page.goto(base);await page.locator('a[href$="since/"]').first().waitFor();
  check('390 portal fits viewport',await noOverflow());await page.screenshot({path:out+'/'+mode+'-portal-mobile.png',fullPage:true});
  await page.locator('a[href$="since/"]').first().click();await sinceReady();
  check('390 Since home fits viewport',await noOverflow());await page.screenshot({path:out+'/'+mode+'-since-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'标签',exact:true}).click();const box=await page.locator('#tags-dialog').boundingBox();
  check('390 tags fit viewport',box.x>=0&&box.x+box.width<=391);await page.getByRole('button',{name:'收起',exact:true}).click();
  await page.locator('.theme-list-card').first().click();await page.locator('.timeline-row').first().waitFor();
  const mobileTitle=await page.locator('.detail-heading h1').innerText();check('390 theme card opens approved topic',Object.values(views).some(view=>view.theme.title===mobileTitle));
  check('390 detail fits viewport',await noOverflow());
  const pan=await page.locator('.timeline').evaluate(e=>{e.scrollLeft=e.scrollWidth;return {left:e.scrollLeft,width:e.scrollWidth,client:e.clientWidth};});
  check('390 remaining branches reachable',pan.width<=pan.client||pan.left>0);
  await page.locator('.timeline-card').first().click();await page.getByRole('button',{name:'查看原稿片段',exact:true}).click();
  check('390 original citation visible',await page.locator('.reading-section .citation').first().isVisible());await assets();
  await page.screenshot({path:out+'/'+mode+'-since-detail-mobile.png',fullPage:true});
  await page.waitForTimeout(5500);await Promise.all(headerReads);
  check('zero API, external or escaped-prefix requests',blocked.length===0);
  check('all HTTP responses successful',responses.every(r=>r.status<400));
  check('zero network failures',failures.length===0);
  check('zero credentials sent',requests.every(r=>!r.has_authorization&&!r.has_cookie));
  check('font and SVG requests present',requests.some(r=>/\.woff2(?:\?|$)/.test(r.url))&&requests.some(r=>/\.svg(?:\?|$)/.test(r.url)));
  check('zero browser script errors',errors.length===0);
  fs.writeFileSync(out+'/'+mode+'-browser-results.json',JSON.stringify({passed:checks,base,browser:browser.version(),requests,responses,blocked,failures,errors},null,2));
  console.log(JSON.stringify({mode,browser_assertions:checks.length,requests:requests.length}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
