const app = document.querySelector('#app');
const dialog = document.querySelector('#tags-dialog');
const dataMode = document.querySelector('meta[name="since-data-mode"]')?.content || 'api';
const state = { themes: [], catalog: null, catalogRevision: null, details: new Map(), selectedId: null, selectedNodeId: null, view: 'home', query: '', tagQuery: '', filters: new Set(), loading: false, error: null, refreshError: null, showMarkdown: false, readerTab: 'node', signature: '', controller: null, focusTagId: null, tagIntent: 'filter', searchOpen: false, articleIndex: null, articleError: null, selectedArticleId: null, focusInitialized: false };
const claimLabels = { fact: '事实', source_statement: '来源说法', inference: '分析推断' };
const basisLabels = { full_text: '正文', transcript: '转写', partial_text: '已读片段', description: '简介', link_only: '仅链接' };
const dateLabels = { event: '发生', publication: '发布', discovery: '发现', unknown: '时间待确认' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || (value === false && !key.startsWith('aria-') && !key.startsWith('data-'))) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') for (const [name, setting] of Object.entries(value)) node.style.setProperty(name, setting);
    else if (value === true) node.setAttribute(key, key.startsWith('aria-') || key.startsWith('data-') ? 'true' : '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function icon(name, width, height = width) { return el('img', { class: 'icon', src: `./assets/${name}.svg`, width, height, alt: '', 'aria-hidden': 'true' }); }
function button(label, fn, className = 'button', attrs = {}) { return el('button', { type: 'button', class: className, onclick: fn, ...attrs }, label); }
function safeURL(value) { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } }
function link(label, href, className = '') { const url = safeURL(href); return url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: className }, label) : el('span', { class: className }, label); }
function currentTheme() { return state.details.get(state.selectedId) || null; }
function tagsById() { return new Map((state.catalog?.tags || []).map(t => [t.id, t])); }
function selectedTags(view) { return (view?.resolved_tags || []).filter(t => t.eligible_for_graph); }
function parseRoute() { const id = new URLSearchParams(location.hash.slice(1)).get('theme'); state.view = id ? 'detail' : 'home'; if (id) state.selectedId = id; }
function navigate(view, id = state.selectedId) { state.view = view; if (id) state.selectedId = id; history.pushState({}, '', view === 'detail' ? `#theme=${encodeURIComponent(id)}` : '#'); state.selectedNodeId = null; state.showMarkdown = false; state.readerTab = 'node'; render(); loadData(); window.scrollTo(0, 0); }
function dataPath(resource, id) {
  const themeId = encodeURIComponent(id || '');
  if (dataMode === 'static') return { themes: './data/themes.json', catalog: './data/catalog.json', theme: `./data/themes/${themeId}.json`, articles: './data/articles.json' }[resource];
  if (dataMode === 'api') return { themes: '/api/themes', catalog: '/api/catalog', theme: `/api/themes/${themeId}`, articles: '/api/articles' }[resource];
  throw new Error('数据读取模式无效');
}
async function request(resource, signal, id) { const response = await fetch(dataPath(resource, id), { cache: 'no-store', credentials: 'same-origin', signal }); let data; try { data = await response.json(); } catch { throw new Error('无法读取服务响应'); } if (!response.ok) throw new Error(data?.error?.message || '读取失败，请重试'); return data; }

async function loadData({ background = false } = {}) {
  if (background && state.loading) return;
  state.controller?.abort();
  const controller = new AbortController(); state.controller = controller; state.loading = true;
  try {
    const [themes, catalogResponse, articlesResult] = await Promise.all([request('themes', controller.signal), request('catalog', controller.signal), request('articles', controller.signal).then(value=>({value}),error=>({error}))]);
    if (articlesResult.value && (articlesResult.value.schema_version !== '1.0' || !Array.isArray(articlesResult.value.articles) || typeof articlesResult.value.available !== 'boolean')) articlesResult.error = new Error('文章数据格式不完整');
    if (!Array.isArray(themes) || !Array.isArray(catalogResponse?.catalog?.tags)) throw new Error('主题数据格式不完整');
    let id = state.selectedId;
    if (!id && themes.length) id = themes[0].theme.id;
    if (state.view === 'home' && id && !themes.some(t => t.theme.id === id)) id = themes[0]?.theme.id || null;
    const summary = themes.find(t => t.theme.id === id);
    let detail = state.details.get(id);
    if (id && (!detail || !summary || detail.revision !== summary.revision || detail.catalog_revision !== catalogResponse.catalog_revision)) {
      detail = await request('theme', controller.signal, id);
      if (!detail?.theme?.id || !Array.isArray(detail.nodes) || !detail.timeline || typeof detail.analysis_markdown !== 'string') throw new Error('主题脉络数据不完整');
    }
    if (controller.signal.aborted) return;
    const signature = JSON.stringify([themes, catalogResponse.catalog_revision, id, detail?.revision, articlesResult.value?.revision, articlesResult.error?.message]);
    const changed = signature !== state.signature || !!state.error || !!state.refreshError;
    state.articleIndex = articlesResult.error ? null : articlesResult.value; state.articleError = articlesResult.error?.message || null;
    if (!state.focusInitialized) state.focusTagId = catalogResponse.catalog.tags.find(t=>t.id==='domain.information-media.recommendation-systems'&&t.status==='active')?.id || catalogResponse.catalog.tags.find(t=>t.depth===2&&t.status==='active')?.id;
    state.focusInitialized = true;
    state.themes = themes; state.catalog = catalogResponse.catalog; state.catalogRevision = catalogResponse.catalog_revision; state.selectedId = id;
    if (detail) state.details.set(id, detail);
    if(state.selectedArticleId&&!articleProjection().byId.has(state.selectedArticleId))state.selectedArticleId=null;reconcileSelection();
    state.signature = signature; state.error = null; state.refreshError = null; state.loading = false;
    if (changed) render();
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.loading = false;
    if (state.themes.length && state.catalog) state.refreshError = error.message;
    else state.error = error.message;
    render();
  }
}

function preserveFocus(fn) {
  const active = document.activeElement, key = active?.dataset.focusKey, start = active?.selectionStart, end = active?.selectionEnd;
  fn();
  if (key) {
    const next = Array.from(document.querySelectorAll('[data-focus-key]')).find(n => n.dataset.focusKey === key);
    next?.focus({ preventScroll: true });
    if (next instanceof HTMLInputElement && typeof start === 'number') next.setSelectionRange(start, end);
  }
}
function render() {
  const oldPanel=document.querySelector('.article-panel'),oldList=document.querySelector('.article-list');
  const articleScroll=oldPanel?.dataset.focusTagId===state.focusTagId ? oldList?.scrollTop||0 : 0;
  preserveFocus(() => {
    app.setAttribute('aria-busy', state.loading ? 'true' : 'false');
    const sidebar = renderSidebar();
    const content = el('main', { id: 'main', class: 'content', tabindex: '-1' }, el('div', { class: 'topbar' }, el('div', { class: 'breadcrumb' }, state.view === 'home' ? null : el('span', {}, '脉络')), state.themes.length && state.themes.every(t => t.is_demo) ? el('span', {}, '示例') : null));
    if (state.refreshError) content.append(el('div', { class: 'refresh-error', role: 'status' }, '更新失败：' + state.refreshError, button('重试', () => loadData(), 'text-button')));
    if (state.error) content.append(el('div', { class: 'page' }, renderError(state.error)));
    else if (!state.catalog) content.append(el('div', { class: 'initial-state', role: 'status' }, '正在读取主题…'));
    else content.append(state.view === 'home' ? renderHome() : renderDetail());
    app.replaceChildren(el('div', { class: `app-shell ${state.view==='home'?'home-view':'detail-view'}` }, sidebar, content));
    if (dialog.open) renderTagDialog();
    const newList=document.querySelector('.article-list');if(newList)newList.scrollTop=articleScroll;
    scheduleGraph();
  });
}
function renderSidebar() {
  return el('aside', { class: 'sidebar' },
    el('div',{class:'sidebar-brand'},el('a', { href: '#', class: 'brand', onclick: e => { e.preventDefault(); navigate('home'); } }, icon('imgGraph', 34), '判断力'),el('details',{class:'mobile-themes'},el('summary',{},'主题'),el('div',{class:'mobile-theme-menu'},state.themes.map(t=>button(t.theme.title,()=>navigate('detail',t.theme.id),'mobile-theme-link')))),state.themes.length&&state.themes.every(t=>t.is_demo)?el('span',{class:'mobile-scope'},'示例'):null),
    el('nav', { class: 'main-nav', 'aria-label': '主导航' },
      button([icon('imgGraph1', 17), '我的关注'], () => navigate('home'), `nav-item ${state.view === 'home' ? 'active' : ''}`, { 'aria-current': state.view === 'home' ? 'page' : null }),
      button([icon('imgTime', 17), '脉络'], () => state.selectedId && navigate('detail'), `nav-item ${state.view === 'detail' ? 'active' : ''}`, { disabled: !state.selectedId, 'aria-current': state.view === 'detail' ? 'page' : null })),
    el('div', { class: 'recent-heading' }, el('span', {}, '最近关注'), el('span', {}, String(state.themes.length).padStart(2, '0'))),
    el('div', { class: 'recent-list' }, state.themes.map(t => button([el('span', { class: 'theme-dot' }, icon(t.theme.id === state.selectedId ? 'img' : 'img1', 7)), el('span',{class:'recent-theme-title'},t.theme.title)], () => navigate('detail', t.theme.id), `recent-theme ${t.theme.id === state.selectedId ? 'active' : ''}`))));
}
function renderError(message) { return el('section', { class: 'error-state', role: 'alert' }, el('h2', {}, '暂时无法读取主题'), el('p', {}, message), button('重试', () => loadData())); }
function searchInput(placeholder, value, update, key) { return el('label', { class: 'search' }, icon('imgSearch', 16), el('input', { type: 'search', placeholder, value, 'aria-label': placeholder, 'data-focus-key': key, oninput: e => update(e.target.value) }), el('kbd', {}, '/')); }
function toggleTag(id) { state.focusTagId=null; state.filters.has(id) ? state.filters.delete(id) : state.filters.add(id); reconcileSelection();render(); }
function focusTag(id) { if(state.focusTagId===id)return;state.focusTagId=id;reconcileSelection();render(); }
function chooseTag(id) { if(state.tagIntent==='focus'){focusTag(id);dialog.close();document.querySelector('.focus-callout')?.focus({preventScroll:true});}else toggleTag(id); }
function tagChip(tag, interactive = true, path = false) { return button([tag.name, path && tag.depth === 3 ? el('span', { class: 'tag-path' }, tagsById().get(tag.parent_id)?.name || '') : null], interactive ? () => chooseTag(tag.id || tag.tag_id) : () => {}, `tag ${(state.tagIntent==='focus'?state.focusTagId=== (tag.id || tag.tag_id):state.filters.has(tag.id || tag.tag_id)) ? 'active' : ''} depth-${tag.depth || 2}`, { 'aria-pressed': interactive ? (state.tagIntent==='focus'?state.focusTagId===(tag.id||tag.tag_id):state.filters.has(tag.id||tag.tag_id)) : null, 'data-focus-key': 'tag-' + (tag.id || tag.tag_id), disabled: !interactive }); }
let projectionCache=null;
function articleProjection(){
  if(projectionCache?.index===state.articleIndex&&projectionCache?.catalog===state.catalog)return projectionCache;
  const byId=new Map(),tags=tagsById(),members=new Map(),contexts=new Map();
  for(const row of state.articleIndex?.articles||[]){if(typeof row.id!=='string'||!Array.isArray(row.tag_ids))continue;const previous=byId.get(row.id);byId.set(row.id,{...(previous||row),tag_ids:[...new Set([...(previous?.tag_ids||[]),...row.tag_ids])].sort()});}
  const records=[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id));
  for(const article of records){const ids=new Set();for(const direct of article.tag_ids){let id=direct;const seen=new Set();while(id&&!seen.has(id)){seen.add(id);ids.add(id);if(!members.has(id))members.set(id,new Set());members.get(id).add(article.id);id=tags.get(id)?.parent_id;}}contexts.set(article.id,ids);}
  projectionCache={index:state.articleIndex,catalog:state.catalog,records,byId,members,contexts};return projectionCache;
}
function matchesArticle(article){
  const model=articleProjection(),context=model.contexts.get(article.id)||new Set(),tags=tagsById();
  if(state.query&&!`${article.title} ${article.tag_ids.map(id=>tags.get(id)?.name||id).join(' ')}`.toLowerCase().includes(state.query.toLowerCase()))return false;
  for(const dimension of ['domain','lens']){const filters=[...state.filters].filter(id=>tags.get(id)?.dimension===dimension);if(filters.length&&!filters.some(id=>context.has(id)))return false;}
  return true;
}
function reconcileSelection(){const article=articleProjection().byId.get(state.selectedArticleId);if(article&&(!matchesArticle(article)||(state.focusTagId&&!articleProjection().members.get(state.focusTagId)?.has(article.id))))state.selectedArticleId=null;}
function selectArticle(id){
  const model=articleProjection();if(!model.byId.has(id))return;
  if(state.focusTagId&&!model.members.get(state.focusTagId)?.has(id))state.focusTagId=null;
  state.selectedArticleId=id;render();const list=document.querySelector('.article-list');if(list)list.scrollTop=0;
}
function renderHome() {
  const filtered=articleProjection().records.filter(matchesArticle);
  const heading=el('div',{class:`page-heading overview-heading ${state.searchOpen?'searching':''}`},el('h1',{},'我的关注'),el('div',{class:'overview-search'},searchInput('搜索文章',state.query,value=>{state.query=value;state.focusTagId=null;reconcileSelection();render();},'theme-search')),button(state.searchOpen?'收起':'搜索',()=>{state.searchOpen=!state.searchOpen;render();if(state.searchOpen)document.querySelector('.overview-search input')?.focus();},'compact-search text-button',{'aria-expanded':state.searchOpen,'data-focus-key':'search-toggle'}),button('标签',()=>openTags('filter'),'button tag-toggle',{'aria-haspopup':'dialog','aria-expanded':dialog.open,'data-focus-key':'tag-toggle'}));
  const page=el('section',{class:'page home-page'},heading);
  if(state.filters.size||state.query){
    const byId=tagsById();
    page.append(el('div',{class:'filters'},el('div',{class:'filters-chips'},[...state.filters].map(id=>button([(byId.get(id)?.name||'标签待复核'),' ×'],()=>toggleTag(id),'tag active',{'data-filter-id':id,'aria-label':'移除筛选 '+(byId.get(id)?.name||id)})),state.query?el('span',{class:'tag'},state.query):null),button('清除',()=>{state.filters.clear();state.query='';state.focusTagId=null;state.selectedArticleId=null;render();},'text-button clear-filters')));
  }
  page.append(el('div',{class:'home-layout'},el('div',{class:'graph-wrap','aria-label':'关注总览'},renderGraph(filtered)),renderArticles()));
  return page;
}
function tagPath(tag){const byId=tagsById(),path=[],seen=new Set();for(let current=tag;current&&!seen.has(current.id);current=byId.get(current.parent_id)){seen.add(current.id);path.unshift(current);}return path;}
function tagContains(parentId,assignedId){const byId=tagsById(),seen=new Set();for(let id=assignedId;id&&!seen.has(id);id=byId.get(id)?.parent_id){if(id===parentId)return true;seen.add(id);}return false;}
function focusArticles(){
  const model=articleProjection(),members=state.focusTagId?model.members.get(state.focusTagId):null;
  return model.records.filter(article=>matchesArticle(article)&&(!state.focusTagId||members?.has(article.id))).sort((a,b)=>(Date.parse(b.published_at)||-Infinity)-(Date.parse(a.published_at)||-Infinity)||a.id.localeCompare(b.id));
}
function publicationDate(value){if(!value)return null;if(/^\d{4}(?:-\d{2})?$/.test(value))return value;const date=new Date(value);return Number.isNaN(date.valueOf())?null:date.toISOString().slice(0,10);}
function articleMeta(article){const date=publicationDate(article.published_at),basis={description:'简介依据',partial_text:'片段依据',full_text:'正文依据',transcript:'转写依据',link_only:'链接依据'}[article.evidence_basis]||'依据待确认';return `${date?date+' 发布':'日期待确认'} · ${basis}`;}
function renderSelectedArticle(article){
  const tags=tagsById();
  return el('section',{class:'selected-article','data-selected-article-id':article.id,'aria-label':'已选文章'},el('div',{class:'selection-heading'},el('span',{},'已选文章'),button('返回列表',()=>{state.selectedArticleId=null;render();},'text-button selection-clear')),el('h3',{class:'selected-title'},article.title),el('p',{class:'article-meta'},articleMeta(article)),link('打开来源',article.url,'selected-source'),el('div',{class:'article-coding'},el('h4',{},'直接标签'),article.tag_ids.map(id=>{const tag=tags.get(id),path=tag?tagPath(tag):[],ancestors=path.slice(0,-1).map(t=>t.name).join(' / ');return button([ancestors?el('span',{class:'coding-context'},ancestors+' / '):null,el('strong',{class:'coding-direct'},tag?.name||id)],()=>focusTag(id),'coding-tag',{'data-direct-tag-id':id,'aria-label':'直接标签：'+(tag?.name||id)+'；路径：'+path.map(t=>t.name).join(' / ')});})));
}
function renderArticles(){
  const model=articleProjection(),tag=tagsById().get(state.focusTagId),path=tag?tagPath(tag):[],articles=focusArticles();
  const parent=path.slice(0,-1).map(t=>t.name).join(' / '),full=path.map(t=>t.name).join(' / '),groupTotal=tag?(model.members.get(tag.id)?.size||0):model.records.length;
  const unavailable=state.articleError||!state.articleIndex?.available;
  const panel=el('aside',{class:'article-panel','aria-label':'文章','data-focus-tag-id':state.focusTagId||'','data-selected-article-id':state.selectedArticleId||'','data-group-count':groupTotal});
  const actions=el('div',{class:'article-actions'},tag?button('全部',()=>{state.focusTagId=null;render();},'text-button focus-reset',{'aria-label':'显示全部文章'}):null,tag?button(state.filters.has(tag.id)?'移除筛选':'筛选文章',()=>toggleTag(tag.id),'text-button panel-filter',{'aria-pressed':state.filters.has(tag.id),'data-focus-key':'panel-filter'}):null);
  panel.append(el('div',{class:'article-heading'},el('div',{class:'article-path-row'},el('p',{class:'article-tag-path','data-full-path':full||'全部文章'},el('span',{class:'desktop-path'},parent||'我的关注'),el('span',{class:'compact-path'},full||'全部文章')),actions),el('div',{class:'article-name-row'},el('h2',{class:'article-tag-name'},tag?.name||'全部文章'),el('span',{class:'article-mobile-label'},tag?'聚焦':'全部'),el('span',{class:'article-count','aria-live':'polite'},unavailable?'—':`${articles.length}${articles.length!==groupTotal?' / '+groupTotal:''} 篇`))));
  const list=el('div',{class:'article-list',tabindex:'0','aria-label':'文章列表','data-focus-key':'article-list'});
  const selected=model.byId.get(state.selectedArticleId);if(selected)list.append(renderSelectedArticle(selected));
  if(unavailable)list.append(el('div',{class:'article-empty',role:'status'},state.articleError?'文章读取失败':'文章暂不可用',state.articleError?button('重试',()=>loadData(),'text-button'):null));
  else if(!articles.length)list.append(el('p',{class:'article-empty',role:'status'},'暂无相关文章'));
  else for(const article of articles){list.append(el('article',{class:`article-row ${article.id===state.selectedArticleId?'selected':''}`,'data-article-id':article.id,'data-selected':article.id===state.selectedArticleId},button([el('h3',{class:'article-title'},article.title),el('p',{class:'article-meta'},articleMeta(article))],()=>selectArticle(article.id),'article-select',{'aria-pressed':article.id===state.selectedArticleId,'data-focus-key':'list-article-'+article.id})));}
  panel.append(list);return panel;
}

const NS='http://www.w3.org/2000/svg';
function svgNode(name,attrs={},textContent){const node=document.createElementNS(NS,name);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,String(v));if(textContent!==undefined)node.textContent=textContent;return node;}
function point(cx,cy,radius,angle){const a=angle*Math.PI/180;return [cx+radius*Math.cos(a),cy+radius*Math.sin(a)];}
function arcPath(cx,cy,inner,outer,start,end){const[a,b,c,d]=[point(cx,cy,outer,start),point(cx,cy,outer,end),point(cx,cy,inner,end),point(cx,cy,inner,start)];const large=end-start>180?1:0;return `M${a} A${outer},${outer} 0 ${large} 1 ${b} L${c} A${inner},${inner} 0 ${large} 0 ${d} Z`;}
function labelLines(name,max=4){if(name==='信息可视化')return['信息','可视化'];if(name==='脑电与神经影像')return['脑电与','神经影像'];const chars=Array.from(name);if(chars.length<=3)return[name];const cut=chars.length>max*2?max:Math.ceil(chars.length/2);return[chars.slice(0,cut).join(''),chars.slice(cut).join('')];}
function themeLines(title){const comma=title.indexOf('，');if(comma>=0&&comma<13)return[title.slice(0,comma+1),title.slice(comma+1)];const split=title.indexOf('表达');return split>0?[title.slice(0,split),title.slice(split)]:labelLines(title,10);}
function graphTags(){
  const tags=(state.catalog?.tags||[]).filter(t=>t.status==='active');
  const used=new Set(articleProjection().members.keys());
  const visible=t=>t.attention_scope!=='available_not_followed'||used.has(t.id);
  const roots=tags.filter(t=>t.depth===1&&t.dimension==='domain'&&(t.origin==='user_confirmed'||used.has(t.id)));
  const total=roots.length||1;
  const marks=[];let cursor=-90;
  roots.forEach(root=>{const children=tags.filter(t=>t.parent_id===root.id&&t.depth===2&&visible(t)),width=360/total;marks.push({tag:root,ring:'domain-1',start:cursor+3,end:cursor+width-3,angle:(cursor*2+width)/2});children.forEach((tag,i)=>{const angle=cursor+(i+.5)*width/(children.length||1);marks.push({tag,ring:'domain-2',start:angle-Math.min(6.5,width/Math.max(1,children.length)*.4),end:angle+Math.min(6.5,width/Math.max(1,children.length)*.4),angle});});cursor+=width;});
  const lenses=tags.filter(t=>t.depth===1&&t.dimension==='lens'&&(['user_confirmed','spielzeit_framework'].includes(t.origin)||used.has(t.id)));
  lenses.forEach((root,i)=>{const angle=-45+i*360/lenses.length;marks.push({tag:root,ring:'lens-1',start:angle-35,end:angle+35,angle});tags.filter(t=>t.depth===2&&t.parent_id===root.id&&visible(t)).forEach((tag,j,children)=>{const a=angle+(j-(children.length-1)/2)*24;marks.push({tag,ring:'lens-2',start:a-8,end:a+8,angle:a});});});
  return marks;
}
function renderGraph(filtered,width,height){
  const compact=innerWidth<=1100,w=width||(compact?innerWidth-32:innerWidth-568),h=height||(compact?350:innerHeight-131),cx=w/2,cy=h/2;
  const rings=compact?{'domain-1':[24,44],'domain-2':[52,72],'lens-1':[96,116],'lens-2':[124,144]}:{'domain-1':[114,146],'domain-2':[154,186],'lens-1':[210,242],'lens-2':[250,282]};
  const stage=el('div',{class:'graph-stage'}),svg=svgNode('svg',{class:'solar-graph',viewBox:`0 0 ${w} ${h}`,role:'group','aria-label':'文章与分类聚合图'}),marks=graphTags(),positions=new Map(),model=articleProjection(),selected=model.byId.get(state.selectedArticleId),coding=model.contexts.get(state.selectedArticleId)||new Set();
  for(const mark of marks){const{tag,ring,start,end,angle}=mark,[inner,outer]=rings[ring];positions.set(tag.id,{...mark,inner,outer});const active=tag.id===state.focusTagId;const group=svgNode('g',{class:'graph-group',role:'button',tabindex:'0','aria-label':tagPath(tag).map(t=>t.name).join(' / ')+`，${model.members.get(tag.id)?.size||0} 篇`,'aria-pressed':active,'data-member-count':model.members.get(tag.id)?.size||0,'data-member-ids':JSON.stringify([...(model.members.get(tag.id)||[])].sort()),'data-coding-selected':coding.has(tag.id),'data-tag-id':tag.id,'data-ring':ring,'data-focus-key':'graph-tag-'+tag.id});
    const d=arcPath(cx,cy,inner,outer,start,end);group.append(svgNode('path',{d,class:'graph-hit'}));group.append(svgNode('path',{d,class:`graph-arc ${active?'active':''} ${state.filters.has(tag.id)?'filter':''} ${coding.has(tag.id)?(selected?.tag_ids.includes(tag.id)?'coded-direct':'coded-parent'):''}`,'data-inner-radius':inner,'data-outer-radius':outer}));
    if(!compact){const radius=(inner+outer)/2,[x,y]=point(cx,cy,radius,angle),lines=labelLines(tag.name,4),text=svgNode('text',{class:`graph-label ${tag.depth===1?'level-one':'level-two'}`,x,y:y-(lines.length-1)*8});lines.forEach((line,i)=>text.append(svgNode('tspan',{x,dy:i?16:0},line)));group.append(text);}
    group.append(svgNode('title',{},tagPath(tag).map(t=>t.name).join(' / ')+`：${model.members.get(tag.id)?.size||0} 篇文章`));group.addEventListener('click',()=>focusTag(tag.id));group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();focusTag(tag.id);}else if(['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const index=marks.findIndex(m=>m.tag.id===tag.id),next=marks[(index+(['ArrowLeft','ArrowUp'].includes(e.key)?marks.length-1:1))%marks.length].tag.id;focusTag(next);document.querySelector(`[data-tag-id="${next}"]`)?.focus({preventScroll:true});}});svg.append(group);
  }
  const matching=new Set(filtered.map(a=>a.id)),focusMembers=state.focusTagId?(model.members.get(state.focusTagId)||new Set()):new Set(model.byId.keys()),hasFilter=!!(state.query||state.filters.size),n=model.records.length;
  const minR=compact?151:294,maxR=Math.max(minR,Math.min(compact?166:340,w/2-12,h/2-12)),baseR=(minR+maxR)/2;
  const dense=n>80,tracks=dense?Math.max(1,Math.ceil(n/Math.max(1,Math.floor(2*Math.PI*baseR/4)))):1;
  const navigation=model.records.filter(a=>matching.has(a.id));
  model.records.forEach((article,i)=>{
    const track=i%tracks,rank=Math.floor(i/tracks),count=Math.floor((n-1-track)/tracks)+1,radius=tracks===1?baseR:minR+track/(tracks-1)*(maxR-minR),angle=-90+(rank+(track%2)*.5)/count*360;
    const[x,y]=point(cx,cy,radius,angle),chosen=article.id===state.selectedArticleId,inFocus=focusMembers.has(article.id),match=matching.has(article.id);
    const node=svgNode('circle',{class:`graph-article ${inFocus?'in-focus':''} ${chosen?'selected':''} ${hasFilter&&!match?'filtered-out':''}`,cx:x,cy:y,r:chosen?7:(dense?1.35:5),role:'button',tabindex:(chosen||(!state.selectedArticleId&&article.id===navigation[0]?.id))?'0':'-1','aria-label':article.title,'aria-pressed':chosen,'data-article-id':article.id,'data-in-focus':inFocus,'data-matches':match,'data-selected':chosen,'data-focus-key':'node-article-'+article.id});
    node.append(svgNode('title',{},article.title));node.addEventListener('click',()=>selectArticle(article.id));node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectArticle(article.id);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const index=navigation.findIndex(a=>a.id===article.id),next=navigation[(index+(['ArrowLeft','ArrowUp'].includes(e.key)?navigation.length-1:1))%navigation.length];if(next){selectArticle(next.id);document.querySelector(`.graph-article[data-article-id="${next.id}"]`)?.focus({preventScroll:true});}}});svg.append(node);
  });
  const total=state.articleIndex?.available?model.records.length:'—';
  svg.append(svgNode('text',{class:'graph-count',x:cx,y:cy-3,'data-global-total':total,style:'font-size:'+(compact&&n>999?'18px':'22px')},total));svg.append(svgNode('text',{class:'graph-count-label',x:cx,y:cy+19},'全部文章'));
  stage.append(el('div',{class:'graph-scope-summary'},el('span',{'data-global-count':state.articleIndex?.available?n:''},state.articleIndex?.available?`全部 ${n} 篇`:'文章暂不可用'),el('span',{'data-focus-count':filtered.filter(a=>focusMembers.has(a.id)).length},state.focusTagId?`聚焦 ${filtered.filter(a=>focusMembers.has(a.id)).length} 篇`:`当前 ${filtered.length} 篇`)));
  if(hasFilter&&!filtered.length)stage.append(el('p',{class:'graph-empty',role:'status'},'没有匹配的文章'));
  stage.append(svg);
  const focus=positions.get(state.focusTagId);
  if(compact&&focus){const[x,y]=point(cx,cy,focus.outer,focus.angle),right=x>=cx,labelWidth=Math.min(156,Array.from(focus.tag.name).length*12+44),lx=Math.min(w-labelWidth-2,Math.max(2,right?x+34:x-labelWidth-34)),ly=Math.min(h-30,Math.max(22,y-13));svg.append(svgNode('line',{class:'focus-leader',x1:x,y1:y,x2:right?lx-4:lx+labelWidth+4,y2:ly+13}));svg.append(svgNode('circle',{class:'focus-point',cx:x,cy:y,r:2.5}));stage.append(button(focus.tag.name+' · '+(model.members.get(focus.tag.id)?.size||0),()=>openTags('focus'),'focus-callout',{'data-focus-key':'focus-callout','data-tag-id':focus.tag.id,'aria-label':'切换焦点标签：'+tagPath(focus.tag).map(t=>t.name).join(' / '),style:{left:lx+'px',top:ly+'px',width:labelWidth+'px'},'aria-haspopup':'dialog'}));}
  if(compact&&!focus){const tag=tagsById().get(state.focusTagId);if(tag)stage.append(button(tag.name,()=>openTags('focus'),'focus-callout',{'data-focus-key':'focus-callout','data-tag-id':tag.id,'aria-label':'切换焦点标签：'+tagPath(tag).map(t=>t.name).join(' / '),style:{left:Math.max(2,w-158)+'px',top:'0px',width:'156px'},'aria-haspopup':'dialog'}));}
  return stage;
}
let graphFrame=0;
function scheduleGraph(){cancelAnimationFrame(graphFrame);graphFrame=requestAnimationFrame(()=>{const wrap=document.querySelector('.graph-wrap');if(!wrap)return;const{width,height}=wrap.getBoundingClientRect();if(width&&height)preserveFocus(()=>wrap.replaceChildren(renderGraph(articleProjection().records.filter(matchesArticle),width,height)));});}

function renderDetail() {
  const page=el('section',{class:'page detail-page'}); const view=currentTheme();
  if(!view){page.append(state.loading?el('div',{class:'initial-state'},'正在读取主题…'):renderError('该主题不存在或尚未保存'));return page;}
  page.append(button([icon('imgBack',14),'返回关注'],()=>navigate('home'),'back-button'),el('div',{class:'detail-heading'},el('h1',{},view.theme.title),button('原稿',()=>openMarkdown(),`button ${state.showMarkdown?'active':''}`)),el('div',{class:'tags-inline'},selectedTags(view).map(t=>el('span',{class:'tag'},t.name)),view.needs_tag_review?el('span',{class:'tag-review'},'标签待复核'):null));
  if(view.theme.question.trim() !== view.theme.title.trim())page.append(el('div',{class:'question-box'},el('span',{class:'question-symbol'},icon('imgSpark',18)),el('p',{},view.theme.question)));
  const ordered=[...(view.timeline.observed||[]),...(view.timeline.upcoming||[]),...(view.timeline.undated||[])];
  let node=ordered.find(n=>n.id===state.selectedNodeId)||ordered[0];if(node)state.selectedNodeId=node.id;
  page.append(el('div',{class:'detail-layout'},renderTimeline(view),renderEvidence(view,node)));
  if(state.showMarkdown)page.append(renderFullMarkdown(view));
  return page;
}
function dateText(node) {const d=node.date;if(d.kind==='unknown')return '时间待确认';return `${d.value}${d.end?'—'+d.end:''} · ${dateLabels[d.kind]||d.kind}${d.occurrence==='planned'?' · 计划':d.occurrence==='prediction'?' · 预测':''}`;}
function renderTimeline(view) {
  const branches=view.branches.length?view.branches:[{id:null,title:'脉络'}],count=branches.length;
  const wrap=el('div',{class:'timeline',style:{'--branches':count},'aria-label':'整体与分支脉络'});
  wrap.append(el('div',{class:'branch-header'},el('span',{},'时间'),branches.map(b=>el('span',{},b.title))));
  for(const [bucket,title] of [['observed',null],['upcoming','计划与预测'],['undated','时间待确认']]){
    const nodes=view.timeline[bucket]||[];if(!nodes.length)continue;
    const rows=el('div',{class:'timeline-rows'});
    nodes.forEach((node,i)=>{
      let indices=node.branch_ids.map(id=>branches.findIndex(b=>b.id===id)).filter(i=>i>=0);if(!indices.length)indices=[0];
      const start=Math.min(...indices),end=Math.max(...indices),span=end-start+1;
      const row=el('div',{class:`timeline-row ${bucket==='undated'?'timeline-undated':''}`,'data-node-id':node.id});
      const value=node.date.value||'';const dateLabel=el('div',{class:'timeline-date'},el('span',{},value.length>=10?value.slice(5).replace('-','.'):value||'—'),value.length>=10?el('span',{},value.slice(0,4)):null,el('span',{class:'date-kind'},dateLabels[node.date.kind]||''));
      const guide=el('span',{class:'timeline-guide',style:{width:`calc(14px + ${start} * ((100% - 86px) / ${count}))`},'aria-hidden':'true'});
      row.append(dateLabel,el('span',{class:'timeline-marker'},icon(i===nodes.length-1?'img4':'img3',16,200)),guide);
      const card=button([el('span',{class:'claim-badge'},node.date.occurrence==='planned'?'计划':node.date.occurrence==='prediction'?'预测':claimLabels[node.claim_kind]||''),el('h3',{},node.title),el('p',{},node.summary),el('span',{class:'node-footer'},icon('imgBook',10),`${node.source_ids.length} 个来源`,el('span',{class:'open-label'},'展开'),icon('imgArrow',10))],()=>{state.selectedNodeId=node.id;state.readerTab='node';render();if(innerWidth<1000)document.querySelector('.evidence-panel')?.scrollIntoView({behavior:'smooth',block:'start'});},`timeline-card ${node.id===state.selectedNodeId?'selected':''}`,{'aria-pressed':node.id===state.selectedNodeId,style:{'grid-column':`${start+2} / span ${span}`}});
      row.append(card);rows.append(row);
    });
    wrap.append(el('section',{class:'timeline-section'},title?el('h2',{class:'section-heading'},title):null,rows));
  }
  return wrap;
}
function renderEvidence(view,node) {
  const panel=el('aside',{class:'evidence-panel','aria-label':'节点详情'});
  if(!node){panel.append(el('p',{},'暂无脉络节点'));return panel;}
  panel.append(el('div',{class:'panel-top'},icon('imgBook2',15),el('div',{class:'tabs'},button('节点',()=>{state.readerTab='node';render();},`tab ${state.readerTab==='node'?'active':''}`),button('原稿',()=>{state.readerTab='original';render();},`tab ${state.readerTab==='original'?'active':''}`))),el('h2',{},node.title),el('p',{class:'evidence-meta'},dateText(node)),el('p',{class:'evidence-meta'},claimLabels[node.claim_kind]||''));
  const body=el('div',{class:'panel-content'});
  if(state.readerTab==='original')body.append(el('section',{class:'evidence-section'},el('h3',{},'原稿片段'),el('div',{class:'reading-section'},renderMarkdown(sectionText(view.analysis_markdown,node.section_id),view,false)),button('打开完整原稿',()=>openMarkdown(node.section_id),'button quiet')));
  else body.append(el('section',{class:'evidence-section'},el('h3',{},'内容'),el('p',{},node.summary),button('查看原稿片段',()=>{state.readerTab='original';render();},'button quiet')));
  const related=view.links.filter(l=>l.from===node.id||l.to===node.id);
  if(related.length)body.append(el('section',{class:'evidence-section'},el('h3',{},'相关节点'),related.map(l=>{const other=view.nodes.find(n=>n.id===(l.from===node.id?l.to:l.from));return button(`${{contrast:'对照',sequence:'顺序',branch:'分支',causal_claim:'来源解释'}[l.kind]} · ${other.title}`,()=>{state.selectedNodeId=other.id;render();},'text-button relation-link');})));
  const sources=view.sources.filter(s=>node.source_ids.includes(s.id));
  body.append(el('section',{class:'evidence-section source-section'},el('h3',{},'来源'),sources.length?sources.map(s=>renderSource(s)):el('p',{},'此节点为分析推断')));panel.append(body);return panel;
}
function archiveURL(source){const a=source.archive_ref;if(!a)return null;return `https://github.com/${a.repository}/blob/${a.commit}/${a.path.split('/').map(encodeURIComponent).join('/')}#L${a.start_line}`;}
function renderSource(source){return el('article',{class:'source-card','data-source-id':source.id},el('h3',{},source.title),el('div',{class:'source-basis'},[source.published_at,basisLabels[source.evidence_basis]].filter(Boolean).join(' · ')),source.quote?el('blockquote',{},source.quote):null,el('div',{class:'source-links'},link([icon('imgExternal',12),'来源'],source.url),archiveURL(source)?link([icon('imgExternal',12),'存档'],archiveURL(source)):null));}
// Share structural recognition between fragment extraction and full-reader anchors.
// Mask examples for recognition only; API Markdown remains unchanged.
function markdownLines(markdown) {
  const lines=markdown.replace(/\r\n?/g,'\n').split('\n');let fence=null;
  const records=lines.map(raw=>{
    if(fence){
      const close=raw.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if(close&&close[1][0]===fence.char&&close[1].length>=fence.length){fence=null;return {raw,type:'fence'};}
      return {raw,type:'code'};
    }
    const open=raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if(open&&(open[1][0]!=='`'||!open[2].includes('`'))){fence={char:open[1][0],length:open[1].length};return {raw,type:'fence'};}
    return {raw,type:/^(?: {4}|\t)/.test(raw)?'code':'text'};
  });
  const spaces=text=>text.replace(/[^\n]/g,' ');
  const outside=records.map(r=>r.type==='text'?r.raw:spaces(r.raw)).join('\n');
  const uncommented=outside.replace(/<!--[\s\S]*?(?:-->|$)/g,spaces);
  const runs=[...uncommented.matchAll(/`+/g)];let visible=uncommented;
  const spans=[];
  for(let i=0;i<runs.length;i++){
    const end=runs.findIndex((run,j)=>j>i&&run[0].length===runs[i][0].length);
    if(end>=0){spans.push([runs[i].index,runs[end].index+runs[end][0].length]);i=end;}
  }
  for(const [start,end] of spans.reverse())visible=visible.slice(0,start)+spaces(visible.slice(start,end))+visible.slice(end);
  const displays=uncommented.split('\n'),recognition=visible.split('\n');
  records.forEach((record,i)=>{
    record.display=displays[i];record.visible=recognition[i];
    record.anchor=record.visible.match(/^ {0,3}<a\s+id=(["'])([A-Za-z0-9_.-]+)\1\s*>\s*<\/a\s*>[ \t]*$/)?.[2]||null;
    record.sourceHeading=/^ {0,3}#{1,6}[ \t]+(?:来源|参考来源|参考资料|Sources|References)(?:[ \t]+#+)?[ \t]*$/i.test(record.visible);
    record.definition=/^ {0,3}\[[^\]]+\]:[ \t]*/.test(record.visible);
  });
  return records;
}
function sectionText(markdown,id){
  const records=markdownLines(markdown),start=records.findIndex(r=>r.anchor===id);
  if(start<0)return '';
  let end=start+1;while(end<records.length&&!records[end].anchor&&!records[end].sourceHeading)end++;
  return records.slice(start,end).map(r=>r.raw).join('\n');
}
function citation(source,view,label){return button(label||`[${view.sources.indexOf(source)+1}]`,()=>{
  state.showMarkdown=true;render();
  document.querySelector(`#full-markdown [data-source-id="${source.id}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});
},'citation',{'aria-label':'查看来源 '+source.title});}
function inlineText(text,view){
  const fragment=document.createDocumentFragment();
  const pattern=/\[([^\]]+)\]\[([A-Za-z0-9_.-]+)\]|\[([^\]]+)\]\(([^)]+)\)|\[([A-Za-z0-9_.-]+)\](?![\[(]|[ \t]*:)/g;
  let start=0,match;
  while((match=pattern.exec(text))){
    fragment.append(document.createTextNode(text.slice(start,match.index)));
    if(match[3])fragment.append(link(match[3],match[4]));
    else{const source=view.sources.find(s=>s.id===(match[2]||match[5]));fragment.append(source?citation(source,view,match[2]?match[1]:null):document.createTextNode(match[0]));}
    start=pattern.lastIndex;
  }
  fragment.append(document.createTextNode(text.slice(start)));return fragment;
}
function renderMarkdown(markdown,view,includeAnchors=true){
  const root=el('div',{class:'markdown'});let paragraph=[],list=null,code=[],bibliography=false;
  function flush(){if(paragraph.length){root.append(el('p',{},inlineText(paragraph.join(' '),view)));paragraph=[];}list=null;}
  function flushCode(){if(code.length){root.append(el('pre',{},el('code',{},code.join('\n'))));code=[];}}
  for(const record of markdownLines(markdown)){
    if(record.type==='fence'){flush();flushCode();continue;}
    if(record.type==='code'){flush();if(!bibliography)code.push(record.raw);continue;}
    flushCode();
    const line=record.display;let match;
    if(record.anchor){flush();bibliography=false;if(includeAnchors)root.append(el('a',{id:'md-'+record.anchor,class:'anchor'}));continue;}
    if(record.sourceHeading){flush();bibliography=true;continue;}
    if(record.definition||bibliography){flush();continue;}
    if(!line.trim()){flush();continue;}
    if(/^ {0,3}#{1,6}\s+/.test(record.visible)&&(match=line.match(/^ {0,3}(#{1,6})\s+(.+)$/))){flush();root.append(el('h'+match[1].length,{},inlineText(match[2],view)));continue;}
    if((match=line.match(/^[-*]\s+(.+)$/))){if(paragraph.length)flush();if(!list){list=el('ul');root.append(list);}list.append(el('li',{},inlineText(match[1],view)));continue;}
    if((match=line.match(/^>\s?(.*)$/))){flush();root.append(el('blockquote',{},inlineText(match[1],view)));continue;}
    paragraph.push(line);
  }
  flush();flushCode();return root;
}
function renderFullMarkdown(view){return el('section',{class:'md-panel',id:'full-markdown'},el('div',{class:'md-heading'},el('h2',{},'分析原稿'),button('收起',()=>{state.showMarkdown=false;render();},'button quiet')),renderMarkdown(view.analysis_markdown,view),el('div',{class:'evidence-section'},el('h3',{},'来源片段'),view.sources.map(renderSource)));}
function openMarkdown(section){state.showMarkdown=true;render();requestAnimationFrame(()=>{const target=document.getElementById(section?'md-'+section:'full-markdown');target?.scrollIntoView({behavior:'smooth',block:'start'});if(target&&section){target.classList.add('highlight');target.nextElementSibling?.classList.add('highlight');}});}

function openTags(intent='filter'){state.tagIntent=intent;renderTagDialog();dialog.showModal();document.querySelector('.tag-toggle')?.setAttribute('aria-expanded','true');}
function renderTagDialog(){dialog.className='tag-dialog';const q=state.tagQuery.toLowerCase();const active=(state.catalog?.tags||[]).filter(t=>t.status==='active'&&['domain','lens'].includes(t.dimension));
  const content=el('div',{},el('div',{class:'dialog-heading'},el('h2',{id:'tags-title'},'标签'),searchInput('搜索标签',state.tagQuery,value=>{state.tagQuery=value;preserveFocus(renderTagDialog);},'tag-search'),button('收起',()=>dialog.close(),'button quiet')));
  for(const dimension of ['domain','lens']){const section=el('section',{class:'tag-dimension'},el('h3',{},dimension==='domain'?'领域':'视角'));let count=0;for(const root of active.filter(t=>t.dimension===dimension&&t.depth===1)){const children=active.filter(t=>t.dimension===dimension&&t.depth>1&&(t.parent_id===root.id||active.find(p=>p.id===t.parent_id)?.parent_id===root.id));const rootMatch=root.name.toLowerCase().includes(q);const filtered=rootMatch?children:children.filter(t=>(t.name+' '+(t.definition||'')+' '+(t.aliases||[]).join(' ')).toLowerCase().includes(q));if(q&&!rootMatch&&!filtered.length)continue;count++;section.append(el('div',{class:'tag-group'},button(root.name,()=>chooseTag(root.id),`tag tag-group-root ${(state.tagIntent==='focus'?state.focusTagId===root.id:state.filters.has(root.id))?'active':''}`,{'aria-pressed':state.tagIntent==='focus'?state.focusTagId===root.id:state.filters.has(root.id),'data-focus-key':'tag-'+root.id}),el('div',{class:'tag-group-children'},filtered.map(t=>tagChip(t,true,true)))));}if(count)content.append(section);}
  if(!content.querySelector('.tag-group'))content.append(el('p',{class:'modal-empty'},'没有匹配的标签'));dialog.replaceChildren(content);
}

dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
dialog.addEventListener('close',()=>{document.querySelector('.tag-toggle')?.setAttribute('aria-expanded','false');if(document.activeElement===document.body)document.querySelector(state.tagIntent==='focus'?'.focus-callout':'.tag-toggle')?.focus({preventScroll:true});});
window.addEventListener('popstate',()=>{parseRoute();state.selectedNodeId=null;state.showMarkdown=false;state.readerTab='node';render();loadData();});
window.addEventListener('resize',()=>{render();});
window.addEventListener('focus',()=>loadData({background:true}));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadData({background:true});});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){event.preventDefault();if(!dialog.open&&state.view==='home'&&innerWidth<=1100&&!state.searchOpen){state.searchOpen=true;render();}document.querySelector(dialog.open?'#tags-dialog input':'.search input')?.focus();}});
setInterval(()=>{if(!document.hidden)loadData({background:true});},4000);
document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();document.getElementById('main')?.focus();});
parseRoute();render();loadData();
