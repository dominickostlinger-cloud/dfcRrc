/* admin panel - simple import + save */
const importBtn = document.getElementById('do-import');
const importUrlEl = document.getElementById('import-url');
const resultDiv = document.getElementById('import-result');
const productListDiv = document.getElementById('product-list');

importBtn.addEventListener('click', async () => {
  const url = importUrlEl.value.trim();
  if (!url) return alert('Bitte URL eingeben');
  resultDiv.innerHTML = 'Importiere...';
  try {
    const res = await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url }) });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Import fehlgeschlagen');
    const p = data.product;
    resultDiv.innerHTML = renderImportCard(p);
    // attach save handler
    document.getElementById('save-product').addEventListener('click', async () => {
      const adminSecret = prompt('Admin Secret (x-admin-secret):');
      if (!adminSecret) return alert('Admin Secret benötigt');
      const productToSave = {
        name: document.getElementById('edit-name').value,
        price: parseFloat(document.getElementById('edit-price').value || 0),
        category: document.getElementById('edit-category').value || 'Uncategorized',
        link: document.getElementById('edit-link').value,
        image: document.getElementById('edit-image').value
      };
      const saveRes = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'x-admin-secret': adminSecret },
        body: JSON.stringify({ product: productToSave })
      });
      const saveData = await saveRes.json();
      if (saveData.success) { alert('Produkt gespeichert'); loadProductsList(); } else { alert('Save failed: ' + (saveData.error||'unknown')); }
    });
  } catch (e) {
    console.error(e);
    resultDiv.innerHTML = `<div style="color:#f55">Fehler: ${e.message}</div>`;
  }
});

function renderImportCard(p){
  return `
    <div style="display:grid;grid-template-columns:160px 1fr;gap:1rem;align-items:start">
      <div><img src="${p.image||'https://via.placeholder.com/300x200'}" style="width:100%;border-radius:8px" /></div>
      <div>
        <label>Name<br><input id="edit-name" value="${escapeHtmlAttr(p.name)}" style="width:100%;padding:.5rem;margin-bottom:.5rem" /></label>
        <label>Preis<br><input id="edit-price" value="${Number(p.price||0).toFixed(2)}" style="width:120px;padding:.5rem;margin-bottom:.5rem" /></label>
        <label>Category<br><input id="edit-category" value="${escapeHtmlAttr(p.category||'')}" style="width:100%;padding:.5rem;margin-bottom:.5rem" /></label>
        <label>Link<br><input id="edit-link" value="${escapeHtmlAttr(p.link||'')}" style="width:100%;padding:.5rem;margin-bottom:.5rem" /></label>
        <label>Image<br><input id="edit-image" value="${escapeHtmlAttr(p.image||'')}" style="width:100%;padding:.5rem;margin-bottom:.5rem" /></label>
        <div style="display:flex;gap:.5rem;">
          <button id="save-product" class="btn-primary">Save</button>
        </div>
      </div>
    </div>
  `;
}

// load current products listing
async function loadProductsList(){
  try {
    const res = await fetch('/api/products');
    const list = await res.json();
    productListDiv.innerHTML = list.map(p => `<div style="padding:.5rem;border-bottom:1px solid #222"><strong>${escapeHtml(p.name)}</strong> — €${Number(p.price||0).toFixed(2)}</div>`).join('');
  } catch (e) { productListDiv.innerHTML = '<div style="color:#f99">Konnte Produkte nicht laden</div>'; }
}
loadProductsList();

function escapeHtml(s=''){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeHtmlAttr(s=''){ return escapeHtml(s).replace(/"/g,'&quot;'); }
