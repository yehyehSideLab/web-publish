const list = document.getElementById('sites');
const status = document.getElementById('status');

function readRegistry(value) {
  if (value?.version !== 1 || !Array.isArray(value.sites)) throw new Error('Invalid registry');
  const ids = new Set();
  for (const site of value.sites) {
    if (!site || typeof site.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(site.id) || ids.has(site.id) || site.path !== site.id + '/' || typeof site.title !== 'string' || !site.title.trim() || typeof site.description !== 'string') throw new Error('Invalid site');
    ids.add(site.id);
  }
  return value.sites;
}

function siteCard(site) {
  const card = document.createElement('a');
  card.className = 'site';
  card.href = './' + site.path;
  const title = document.createElement('h2');
  title.textContent = site.title;
  const description = document.createElement('p');
  description.textContent = site.description;
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  card.append(title, description, arrow);
  return card;
}

async function load() {
  list.setAttribute('aria-busy', 'true');
  status.setAttribute('role', 'status');
  status.hidden = false;
  status.textContent = '正在读取…';
  list.replaceChildren();
  try {
    const response = await fetch('./sites.json', { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('Registry unavailable');
    const sites = readRegistry(await response.json());
    list.replaceChildren(...sites.map(siteCard));
    if (sites.length) status.hidden = true;
    else status.textContent = '暂无网站';
  } catch {
    status.setAttribute('role', 'alert');
    const message = document.createElement('p');
    message.textContent = '暂时无法读取网站';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'retry';
    retry.textContent = '重试';
    retry.addEventListener('click', load);
    status.replaceChildren(message, retry);
  } finally { list.setAttribute('aria-busy', 'false'); }
}
load();
