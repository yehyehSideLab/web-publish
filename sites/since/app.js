const app = document.querySelector('#app');
const dialog = document.querySelector('#tags-dialog');
const dataMode = document.querySelector('meta[name="since-data-mode"]')?.content || 'api';
const state = { themes: [], catalog: null, catalogRevision: null, details: new Map(), selectedId: null, selectedNodeId: null, view: 'home', query: '', tagQuery: '', filters: new Set(), loading: false, error: null, refreshError: null, showMarkdown: false, readerTab: 'node', signature: '', controller: null, graphOpen: innerWidth > 720 };
const claimLabels = { fact: '事实', source_statement: '来源说法', inference: '分析推断' };
const basisLabels = { full_text: '正文', transcript: '转写', partial_text: '已读片段', description: '简介', link_only: '仅链接' };
const dateLabels = { event: '发生', publication: '发布', discovery: '发现', unknown: '时间待确认' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') for (const [name, setting] of Object.entries(value)) node.style.setProperty(name, setting);
    else if (value === true) node.setAttribute(key, '');
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
  if (dataMode === 'static') return { themes: './data/themes.json', catalog: './data/catalog.json', theme: `./data/themes/${themeId}.json` }[resource];
  if (dataMode === 'api') return { themes: '/api/themes', catalog: '/api/catalog', theme: `/api/themes/${themeId}` }[resource];
  throw new Error('数据读取模式无效');
}
async function request(resource, signal, id) { const response = await fetch(dataPath(resource, id), { cache: 'no-store', credentials: 'same-origin', signal }); let data; try { data = await response.json(); } catch { throw new Error('无法读取服务响应'); } if (!response.ok) throw new Error(data?.error?.message || '读取失败，请重试'); return data; }

async function loadData({ background = false } = {}) {
  if (background && state.loading) return;
  state.controller?.abort();
  const controller = new AbortController(); state.controller = controller; state.loading = true;
  try {
    const [themes, catalogResponse] = await Promise.all([request('themes', controller.signal), request('catalog', controller.signal)]);
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
    const signature = JSON.stringify([themes, catalogResponse.catalog_revision, id, detail?.revision]);
    const changed = signature !== state.signature || !!state.error || !!state.refreshError;
    state.themes = themes; state.catalog = catalogResponse.catalog; state.catalogRevision = catalogResponse.catalog_revision; state.selectedId = id;
    if (detail) state.details.set(id, detail);
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
  preserveFocus(() => {
    app.setAttribute('aria-busy', state.loading ? 'true' : 'false');
    const sidebar = renderSidebar();
    const content = el('main', { id: 'main', class: 'content', tabindex: '-1' }, el('div', { class: 'topbar' }, el('div', { class: 'breadcrumb' }, el('span', {}, '我的空间'), el('span', {}, '/'), el('span', {}, state.view === 'home' ? '我的关注' : '脉络')), state.themes.length && state.themes.every(t => t.is_demo) ? el('span', {}, '示例') : null));
    if (state.refreshError) content.append(el('div', { class: 'refresh-error', role: 'status' }, '更新失败：' + state.refreshError, button('重试', () => loadData(), 'text-button')));
    if (state.error) content.append(el('div', { class: 'page' }, renderError(state.error)));
    else if (!state.catalog) content.append(el('div', { class: 'initial-state', role: 'status' }, '正在读取主题…'));
    else content.append(state.view === 'home' ? renderHome() : renderDetail());
    app.replaceChildren(el('div', { class: 'app-shell' }, sidebar, content));
    if (dialog.open) renderTagDialog();
  });
}
function renderSidebar() {
  return el('aside', { class: 'sidebar' },
    el('a', { href: '#', class: 'brand', onclick: e => { e.preventDefault(); navigate('home'); } }, icon('imgGraph', 34), '判断力'),
    el('nav', { class: 'main-nav', 'aria-label': '主导航' },
      button([icon('imgGraph1', 17), '我的关注'], () => navigate('home'), `nav-item ${state.view === 'home' ? 'active' : ''}`, { 'aria-current': state.view === 'home' ? 'page' : null }),
      button([icon('imgTime', 17), '脉络'], () => state.selectedId && navigate('detail'), `nav-item ${state.view === 'detail' ? 'active' : ''}`, { disabled: !state.selectedId, 'aria-current': state.view === 'detail' ? 'page' : null })),
    el('div', { class: 'recent-heading' }, el('span', {}, '主题'), el('span', {}, String(state.themes.length).padStart(2, '0'))),
    el('div', { class: 'recent-list' }, state.themes.map(t => button([el('span', { class: 'theme-dot' }, icon(t.theme.id === state.selectedId ? 'img' : 'img1', 7)), t.theme.title], () => navigate('detail', t.theme.id), `recent-theme ${t.theme.id === state.selectedId ? 'active' : ''}`))),
    el('div', { class: 'sidebar-bottom' }, link([icon('imgBook1', 16), 'Spielzeit 资料', el('span', { class: 'end-icon' }, icon('imgArrow1', 13))], 'https://github.com/Leahyeah/Spielzeit', 'archive-link'), el('div', { class: 'space' }, el('span', { class: 'avatar' }, 'Y'), '我的空间')));
}
function renderError(message) { return el('section', { class: 'error-state', role: 'alert' }, el('h2', {}, '暂时无法读取主题'), el('p', {}, message), button('重试', () => loadData())); }
function searchInput(placeholder, value, update, key) { return el('label', { class: 'search' }, icon('imgSearch', 16), el('input', { type: 'search', placeholder, value, 'aria-label': placeholder, 'data-focus-key': key, oninput: e => update(e.target.value) }), el('kbd', {}, '/')); }
function toggleTag(id) { state.filters.has(id) ? state.filters.delete(id) : state.filters.add(id); render(); }
function tagChip(tag, interactive = true, path = false) { return button([tag.name, path && tag.depth === 3 ? el('span', { class: 'tag-path' }, tagsById().get(tag.parent_id)?.name || '') : null], interactive ? () => toggleTag(tag.id || tag.tag_id) : () => {}, `tag ${state.filters.has(tag.id || tag.tag_id) ? 'active' : ''} depth-${tag.depth || 2}`, { 'aria-pressed': interactive ? state.filters.has(tag.id || tag.tag_id) : null, 'data-focus-key': 'tag-' + (tag.id || tag.tag_id), disabled: !interactive }); }
function matches(theme) {
  if (state.query && !`${theme.theme.title} ${theme.theme.question} ${theme.theme.scope}`.toLowerCase().includes(state.query.toLowerCase())) return false;
  const tags = tagsById();
  const assigned = new Set(selectedTags(theme).flatMap(t => [t.tag_id, ...(t.path || []).map(p => p.id)]));
  for (const dimension of ['domain', 'lens']) {
    const filters = [...state.filters].filter(id => tags.get(id)?.dimension === dimension);
    if (filters.length && !filters.some(id => assigned.has(id))) return false;
  }
  return true;
}
function renderHome() {
  const filtered = state.themes.filter(matches);
  const page = el('section', { class: 'page home-page' }, el('div', { class: 'page-heading' }, el('h1', {}, '我的关注'), searchInput('搜索主题', state.query, value => { state.query = value; render(); }, 'theme-search'), button('标签', openTags, 'button tag-toggle', { 'aria-haspopup': 'dialog', 'aria-expanded': dialog.open })));
  const filterTags = tagsById();
  page.append(el('div', { class: 'filters' }, [...state.filters].map(id => tagChip(filterTags.get(id) || { id, name: '标签待复核' })), state.filters.size ? button('清除', () => { state.filters.clear(); render(); }, 'text-button') : null));
  if (!state.themes.length) { page.append(el('div', { class: 'empty-state' }, '还没有已保存的主题')); return page; }
  const graph = el('details', { class: 'graph-disclosure', open: state.graphOpen, ontoggle: e => { state.graphOpen = e.target.open; } }, el('summary', {}, '标签图'), el('div', { class: 'graph-wrap' }, renderGraph(filtered)), el('div', { class: 'graph-legend' }, ['领域一级', '领域二级', '视角一级', '视角二级', '主题'].map(t => el('span', {}, t))));
  const preview = filtered.some(t => t.theme.id === state.selectedId) ? currentTheme() : null;
  const cards = filtered.map(t => button([
    el('h3', {}, t.theme.title),
    el('div', { class: 'tags-inline' }, selectedTags(t).map(tag => el('span', { class: 'tag' }, tag.name)))
  ], () => innerWidth <= 720 ? navigate('detail', t.theme.id) : selectTheme(t.theme.id), `theme-list-card ${t.theme.id === state.selectedId ? 'active' : ''}`));
  const themeList = filtered.length ? el('div', { class: 'theme-list' }, cards) : el('div', { class: 'empty-state' }, '没有匹配的主题');
  page.append(el('div', { class: 'home-layout' }, el('div', {}, graph, themeList), renderPreview(preview, filtered)));
  return page;
}
function selectTheme(id) { state.selectedId = id; state.selectedNodeId = null; render(); loadData(); }
function renderPreview(view, filtered) {
  if (!view) return el('aside', { class: 'theme-preview' }, el('h2', {}, state.loading ? '正在读取…' : filtered.length ? '选择一个主题' : '暂无主题'));
  const sources = view.sources.filter(s => new Set(view.nodes.flatMap(n => n.source_ids)).has(s.id)).slice(0, 3);
  return el('aside', { class: 'theme-preview', 'aria-label': '当前主题' }, el('h2', {}, view.theme.title), el('div', { class: 'preview-tags' }, selectedTags(view).map(tag => el('span', { class: 'tag selected' }, tag.name)),view.needs_tag_review?el('span',{class:'tag-review'},'标签待复核'):null),
    el('div', { class: 'preview-sources' }, el('h3', {}, '相关材料'), sources.map(s => el('div', { class: 'source-teaser' }, el('p', {}, s.title), link('阅读', s.url, 'button')))),
    el('div', { class: 'preview-bottom' }, button('查看脉络 →', () => navigate('detail'), 'button primary')));
}

const NS = 'http://www.w3.org/2000/svg';
function svgNode(name, attrs = {}, textContent) { const node = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); if (textContent !== undefined) node.textContent = textContent; return node; }
function polar(radius, angle) { const a = angle * Math.PI / 180; return [510 + radius * Math.cos(a), 510 + radius * Math.sin(a)]; }
function arcPath(inner, outer, start, end) { const [a,b,c,d] = [polar(outer,start),polar(outer,end),polar(inner,end),polar(inner,start)]; const large = end-start > 180 ? 1 : 0; return `M${a} A${outer},${outer} 0 ${large} 1 ${b} L${c} A${inner},${inner} 0 ${large} 0 ${d} Z`; }
function labelLines(name, max = 4) { const chars = Array.from(name); if (chars.length <= 3) return [name]; const cut = chars.length > max * 2 ? max : Math.ceil(chars.length / 2); return [chars.slice(0, cut).join(''), chars.slice(cut).join('')]; }
function renderGraph(themes) {
  const svg = svgNode('svg', { class: 'solar-graph', viewBox: '0 0 1020 1020', role: 'group', 'aria-label': '领域、视角与主题标签图' });
  const tags = (state.catalog?.tags || []).filter(t => t.status === 'active'); const byId = tagsById();
  const used = new Set(state.themes.flatMap(t => selectedTags(t).flatMap(tag => [tag.tag_id,...(tag.path || []).map(p => p.id)])));
  const selected = new Set(selectedTags(currentTheme()).flatMap(tag => [tag.tag_id,...(tag.path || []).map(p => p.id)]));
  function mark(tag, inner, outer, start, end, radius, width = 4) {
    const group = svgNode('g', { class: 'graph-group', role: 'button', tabindex: '0', 'aria-label': tag.name, 'aria-pressed': state.filters.has(tag.id) });
    group.append(svgNode('path', { d: arcPath(inner,outer,start,end), class: `graph-arc ${selected.has(tag.id) ? 'active' : ''} ${state.filters.has(tag.id) ? 'filter' : ''}` }));
    const [x,y] = polar(radius,(start+end)/2), lines = labelLines(tag.name,width); const text = svgNode('text',{class:'graph-label',x,y:y-(lines.length-1)*8});
    lines.forEach((line,i)=>text.append(svgNode('tspan',{x,dy:i?16:0},line))); group.append(text);
    group.addEventListener('click',()=>toggleTag(tag.id));group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleTag(tag.id);}});svg.append(group);
  }
  const roots = tags.filter(t=>t.depth===1 && t.dimension==='domain' && (t.origin==='user_confirmed'||used.has(t.id)));
  const leaves = roots.map(root=>({root,children:tags.filter(t=>t.parent_id===root.id&&t.depth===2&&(t.attention_scope!=='available_not_followed'||used.has(t.id)))}));
  const total = leaves.reduce((n,g)=>n+g.children.length,0)||1;let cursor=-104;
  for(const {root,children} of leaves){const width=children.length/total*360;mark(root,70,110,cursor+3,cursor+width-3,40,4);children.forEach((child,i)=>{const center=cursor+(i+.5)*width/(children.length||1);mark(child,176,204,center-6.5,center+6.5,190,4);});cursor+=width;}
  const lenses=tags.filter(t=>t.depth===1&&t.dimension==='lens'&&(['user_confirmed','spielzeit_framework'].includes(t.origin)||used.has(t.id)));
  lenses.forEach((root,i)=>{const center=-45+i*360/lenses.length;mark(root,252,276,center-35,center+35,264,4);const children=tags.filter(t=>t.depth===2&&t.parent_id===root.id&&(t.attention_scope!=='available_not_followed'||used.has(t.id)));children.forEach((child,j)=>{const angle=center+(j-(children.length-1)/2)*24;mark(child,300,324,angle-8,angle+8,312,4);});});
  themes.forEach((theme,i)=>{const angle=themes.length===1?-135:-135+i*180;const [x,y]=polar(400,angle),[sx,sy]=polar(374,angle),[tx,ty]=polar(452,angle);const active=theme.theme.id===state.selectedId;const group=svgNode('g',{class:`graph-theme ${active?'active':''}`,role:'button',tabindex:'0','aria-label':theme.theme.title});group.append(svgNode('line',{x1:sx,y1:sy,x2:x,y2:y}));group.append(svgNode('circle',{cx:x,cy:y,r:active?6:4}));const label=svgNode('text',{x:tx,y:ty-9});labelLines(theme.theme.title,10).forEach((line,j)=>label.append(svgNode('tspan',{x:tx,dy:j?19:0},line)));group.append(label);group.addEventListener('click',()=>selectTheme(theme.theme.id));group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectTheme(theme.theme.id);}});svg.append(group);});
  return svg;
}

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

function openTags(){renderTagDialog();dialog.showModal();document.querySelector('.tag-toggle')?.setAttribute('aria-expanded','true');}
function renderTagDialog(){dialog.className='tag-dialog';const q=state.tagQuery.toLowerCase();const active=(state.catalog?.tags||[]).filter(t=>t.status==='active'&&['domain','lens'].includes(t.dimension));
  const content=el('div',{},el('div',{class:'dialog-heading'},el('h2',{id:'tags-title'},'标签'),searchInput('搜索标签',state.tagQuery,value=>{state.tagQuery=value;preserveFocus(renderTagDialog);},'tag-search'),button('收起',()=>dialog.close(),'button quiet')));
  for(const dimension of ['domain','lens']){const section=el('section',{class:'tag-dimension'},el('h3',{},dimension==='domain'?'领域':'视角'));let count=0;for(const root of active.filter(t=>t.dimension===dimension&&t.depth===1)){const children=active.filter(t=>t.dimension===dimension&&t.depth>1&&(t.parent_id===root.id||active.find(p=>p.id===t.parent_id)?.parent_id===root.id));const rootMatch=root.name.toLowerCase().includes(q);const filtered=rootMatch?children:children.filter(t=>(t.name+' '+(t.definition||'')+' '+(t.aliases||[]).join(' ')).toLowerCase().includes(q));if(q&&!rootMatch&&!filtered.length)continue;count++;section.append(el('div',{class:'tag-group'},button(root.name,()=>toggleTag(root.id),`tag tag-group-root ${state.filters.has(root.id)?'active':''}`,{'aria-pressed':state.filters.has(root.id),'data-focus-key':'tag-'+root.id}),el('div',{class:'tag-group-children'},filtered.map(t=>tagChip(t,true,true)))));}if(count)content.append(section);}
  if(!content.querySelector('.tag-group'))content.append(el('p',{class:'modal-empty'},'没有匹配的标签'));dialog.replaceChildren(content);
}

dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
dialog.addEventListener('close',()=>document.querySelector('.tag-toggle')?.setAttribute('aria-expanded','false'));
window.addEventListener('popstate',()=>{parseRoute();state.selectedNodeId=null;state.showMarkdown=false;state.readerTab='node';render();loadData();});
window.addEventListener('focus',()=>loadData({background:true}));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadData({background:true});});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){event.preventDefault();document.querySelector(dialog.open?'#tags-dialog input':'.search input')?.focus();}});
setInterval(()=>{if(!document.hidden)loadData({background:true});},4000);
document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();document.getElementById('main')?.focus();});
parseRoute();render();loadData();
