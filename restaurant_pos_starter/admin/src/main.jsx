import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

async function request(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('pos_token') || '');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [restaurants, setRestaurants] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [areas, setAreas] = useState([]);
  const [tables, setTables] = useState([]);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ email: '', password: '' });
  const [newRestaurant, setNewRestaurant] = useState({ name: '', organizationName: '', adminEmail: '', adminPassword: '', currency: 'IQD', timezone: 'Asia/Baghdad' });
  const [areaName, setAreaName] = useState('');
  const [tableForm, setTableForm] = useState({ tableName: '', serviceAreaId: '' });
  const [categoryName, setCategoryName] = useState('');
  const [itemForm, setItemForm] = useState({ name: '', price: '', categoryId: '', routingGroup: 'kitchen' });

  async function load() {
    if (!token || !user) return;
    if (user.role === 'master_admin') {
      const data = await request('/master/restaurants', token);
      setRestaurants(data.restaurants);
    } else if (user.role === 'restaurant_admin') {
      const [d, a, t, c, m] = await Promise.all([
        request('/restaurant/dashboard', token),
        request('/restaurant/service-areas', token),
        request('/restaurant/tables', token),
        request('/restaurant/menu/categories', token),
        request('/restaurant/menu/items', token)
      ]);
      setDashboard(d); setAreas(a.serviceAreas); setTables(t.tables);
      setCategories(c.categories); setItems(m.items);
    }
  }

  useEffect(() => {
    if (token && !user) {
      request('/auth/me', token).then(setUser).catch(() => {
        localStorage.removeItem('pos_token'); setToken('');
      });
    }
  }, [token]);

  useEffect(() => { load().catch(e => setError(e.message)); }, [token, user]);

  async function act(fn) {
    setError(''); setBusy(true);
    try { await fn(); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function login(e) {
    e.preventDefault();
    await act(async () => {
      const data = await request('/auth/login', '', { method: 'POST', body: JSON.stringify(form) });
      localStorage.setItem('pos_token', data.accessToken);
      setToken(data.accessToken); setUser(data.user);
    });
  }
  function logout() {
    localStorage.removeItem('pos_token'); setToken(''); setUser(null);
    setRestaurants([]); setDashboard(null);
  }

  if (!token || !user) return <main className="login-wrap">
    <form className="panel login" onSubmit={login}>
      <p className="eyebrow">RESTAURANT PLATFORM</p><h1>POS Control Center</h1>
      <p className="muted">Sign in with your Master Admin or Restaurant Admin account.</p>
      {error && <p className="error">{error}</p>}
      <label>Email<input type="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
      <label>Password<input type="password" required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>
      <button disabled={busy}>Sign in</button>
    </form>
  </main>;

  return <main>
    <header><div><p className="eyebrow">RESTAURANT PLATFORM</p><h1>{user.role === 'master_admin' ? 'Master Admin' : 'Restaurant Admin'}</h1><p className="muted">{user.email}</p></div><button className="secondary" onClick={logout}>Sign out</button></header>
    {error && <p className="error">{error}</p>}
    {user.role === 'master_admin' && <>
      <section className="panel">
        <h2>Register a restaurant</h2>
        <form className="form-grid" onSubmit={e=>{e.preventDefault();act(async()=>{
          await request('/master/restaurants',token,{method:'POST',body:JSON.stringify(newRestaurant)});
          setNewRestaurant({name:'',organizationName:'',adminEmail:'',adminPassword:'',currency:'IQD',timezone:'Asia/Baghdad'});
        });}}>
          <label>Restaurant name<input required value={newRestaurant.name} onChange={e=>setNewRestaurant({...newRestaurant,name:e.target.value})}/></label>
          <label>Organization<input value={newRestaurant.organizationName} onChange={e=>setNewRestaurant({...newRestaurant,organizationName:e.target.value})}/></label>
          <label>Admin email<input type="email" required value={newRestaurant.adminEmail} onChange={e=>setNewRestaurant({...newRestaurant,adminEmail:e.target.value})}/></label>
          <label>Temporary password<input type="password" minLength="12" required value={newRestaurant.adminPassword} onChange={e=>setNewRestaurant({...newRestaurant,adminPassword:e.target.value})}/></label>
          <label>Currency (ISO 4217)<input maxLength="3" value={newRestaurant.currency} onChange={e=>setNewRestaurant({...newRestaurant,currency:e.target.value.toUpperCase()})}/></label>
          <label>Timezone<input value={newRestaurant.timezone} onChange={e=>setNewRestaurant({...newRestaurant,timezone:e.target.value})}/></label>
          <button disabled={busy}>Create restaurant</button>
        </form>
      </section>
      <section className="panel"><h2>Restaurants ({restaurants.length})</h2>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Organization</th><th>Currency</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{restaurants.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.organization_name}</td><td>{r.currency}</td><td>{r.active?'Active':'Disabled'}</td><td><button className="small secondary" onClick={()=>act(()=>request(`/master/restaurants/${r.id}/active`,token,{method:'PATCH',body:JSON.stringify({active:!r.active})}))}>{r.active?'Disable':'Enable'}</button></td></tr>)}</tbody></table></div>
      </section>
    </>}
    {user.role === 'restaurant_admin' && <>
      <section className="stats">
        <article><span>Today's orders</span><strong>{dashboard?.orders?.total ?? '—'}</strong><small>{dashboard?.orders?.active ?? 0} active</small></article>
        <article><span>Tables</span><strong>{dashboard?.tables?.total ?? '—'}</strong><small>{dashboard?.tables?.occupied ?? 0} occupied</small></article>
        <article><span>Menu items</span><strong>{dashboard?.menuItems?.total ?? '—'}</strong><small>{dashboard?.menuItems?.active ?? 0} active</small></article>
      </section>
      <section className="columns">
        <div className="panel"><h2>Service areas</h2><form className="inline-form" onSubmit={e=>{e.preventDefault();act(async()=>{await request('/restaurant/service-areas',token,{method:'POST',body:JSON.stringify({name:areaName})});setAreaName('');});}}><input placeholder="e.g. Indoor" required value={areaName} onChange={e=>setAreaName(e.target.value)}/><button disabled={busy}>Add</button></form>
          <ul>{areas.map(a=><li key={a.id}>{a.name}<span>{a.table_count} tables</span></li>)}</ul>
        </div>
        <div className="panel"><h2>Dining tables</h2><form className="inline-form" onSubmit={e=>{e.preventDefault();act(async()=>{await request('/restaurant/tables',token,{method:'POST',body:JSON.stringify(tableForm)});setTableForm({...tableForm,tableName:''});});}}><input placeholder="Table name" required value={tableForm.tableName} onChange={e=>setTableForm({...tableForm,tableName:e.target.value})}/><select required value={tableForm.serviceAreaId} onChange={e=>setTableForm({...tableForm,serviceAreaId:e.target.value})}><option value="">Area</option>{areas.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><button disabled={busy||!areas.length}>Add</button></form>
          <ul>{tables.map(t=><li key={t.id}>{t.table_name}<span>{t.service_area_name} · {t.status}</span></li>)}</ul>
        </div>
      </section>
      <section className="columns">
        <div className="panel"><h2>Menu categories</h2><form className="inline-form" onSubmit={e=>{e.preventDefault();act(async()=>{await request('/restaurant/menu/categories',token,{method:'POST',body:JSON.stringify({name:categoryName})});setCategoryName('');});}}><input placeholder="Category name" required value={categoryName} onChange={e=>setCategoryName(e.target.value)}/><button disabled={busy}>Add</button></form><ul>{categories.map(c=><li key={c.id}>{c.name}</li>)}</ul></div>
        <div className="panel"><h2>Add menu item</h2><form className="stack" onSubmit={e=>{e.preventDefault();act(async()=>{await request('/restaurant/menu/items',token,{method:'POST',body:JSON.stringify({...itemForm,price:Number(itemForm.price),categoryId:itemForm.categoryId||null})});setItemForm({...itemForm,name:'',price:''});});}}>
          <input placeholder="Item name" required value={itemForm.name} onChange={e=>setItemForm({...itemForm,name:e.target.value})}/>
          <input type="number" min="0" step="0.01" placeholder="Price" required value={itemForm.price} onChange={e=>setItemForm({...itemForm,price:e.target.value})}/>
          <select value={itemForm.categoryId} onChange={e=>setItemForm({...itemForm,categoryId:e.target.value})}><option value="">No category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={itemForm.routingGroup} onChange={e=>setItemForm({...itemForm,routingGroup:e.target.value})}><option value="kitchen">Kitchen</option><option value="bar">Bar</option><option value="other">Other</option></select>
          <button disabled={busy}>Save item</button></form>
        </div>
      </section>
      <section className="panel"><h2>Menu items</h2><div className="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Route</th><th>Status</th><th></th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.name}</td><td>{i.category_name||'—'}</td><td>{i.price}</td><td>{i.routing_group}</td><td>{i.active?'Active':'Inactive'}</td><td><button className="small secondary" onClick={()=>act(()=>request(`/restaurant/menu/items/${i.id}/active`,token,{method:'PATCH',body:JSON.stringify({active:!i.active})}))}>{i.active?'Disable':'Enable'}</button></td></tr>)}</tbody></table></div></section>
    </>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
