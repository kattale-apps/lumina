"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";

function SupplierWorkspace({tenantId}:{tenantId:Id<"tenants">}){
  const suppliers=useQuery(api.suppliers.listSuppliers,{tenantId});
  const offers=useQuery(api.suppliers.listSupplierOffers,{tenantId});
  const createSupplier=useMutation(api.suppliers.createSupplier);
  const createOffer=useMutation(api.suppliers.createSupplierOffer);
  const adjust=useMutation(api.suppliers.adjustSupplierStock);
  const [supplierName,setSupplierName]=useState("");
  const [contactName,setContactName]=useState("");
  const [email,setEmail]=useState("");
  const [phone,setPhone]=useState("");
  const [supplierId,setSupplierId]=useState("");
  const [category,setCategory]=useState("Solar panels");
  const [name,setName]=useState("");
  const [brand,setBrand]=useState("");
  const [model,setModel]=useState("");
  const [sku,setSku]=useState("");
  const [currency,setCurrency]=useState("UGX");
  const [cost,setCost]=useState("");
  const [margin,setMargin]=useState("20");
  const [floor,setFloor]=useState("10");
  const [quantity,setQuantity]=useState("0");
  const [minimum,setMinimum]=useState("1");
  const [lead,setLead]=useState("0");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");

  async function addSupplier(e:FormEvent){
    e.preventDefault();setBusy(true);setNotice("");
    try{await createSupplier({tenantId,name:supplierName,contactName,email,phone});
      setSupplierName("");setContactName("");setEmail("");setPhone("");setNotice("Supplier company added.");
    }catch(err){setNotice(errorMessage(err));}finally{setBusy(false);}
  }
  async function addOffer(e:FormEvent){
    e.preventDefault();if(!supplierId){setNotice("Choose a supplier first.");return;}
    setBusy(true);setNotice("");
    try{await createOffer({
      tenantId,supplierId:supplierId as Id<"supplierCompanies">,category,name,brand,model,supplierSku:sku,
      currency,unitCost:Number(cost),marginPercent:Number(margin),floorMarginPercent:Number(floor),
      availableQuantity:Number(quantity),minimumOrderQuantity:Number(minimum),leadTimeDays:Number(lead)
    });setName("");setBrand("");setModel("");setSku("");setCost("");setQuantity("0");setNotice("Supplier product added to the consolidated catalogue.");
    }catch(err){setNotice(errorMessage(err));}finally{setBusy(false);}
  }
  async function stockMove(offerId:Id<"supplierOffers">,type:"receipt"|"issue"){
    const raw=window.prompt(type==="receipt"?"Quantity received":"Quantity issued");
    if(raw===null)return;const n=Number(raw);
    if(!Number.isInteger(n)||n<=0){setNotice("Enter a positive whole quantity.");return;}
    try{await adjust({tenantId,offerId,type,quantity:n,reason:type==="receipt"?"Supplier stock receipt":"Supplier stock issue",idempotencyKey:crypto.randomUUID()});setNotice("Supplier stock updated.");}
    catch(err){setNotice(errorMessage(err));}
  }
  if(!suppliers||!offers)return <p className="muted">Loading supplier inventory…</p>;
  return <>
    <p className="muted">Supplier products remain attributed to their source company. Selling prices are calculated from supplier cost plus the configured margin. Supplier stock is tracked separately from Lumina-owned stock.</p>
    {notice?<p className="form-success" role="status">{notice}</p>:null}
    <section className="workspace-section">
      <h2>Supplier companies ({suppliers.length})</h2>
      <ul className="record-list">{suppliers.map(s=><li className="record-card" key={s.id}>
        <div><span className="record-title">{s.name}</span><span className="record-meta">{s.contactName} · {s.email} · {s.phone}</span><span className="record-meta">{s.status}</span></div>
      </li>)}</ul>
      <form className="panel-form" onSubmit={addSupplier}>
        <h3>Add supplier company</h3>
        <label htmlFor="supplier-name">Company name</label><input id="supplier-name" required value={supplierName} onChange={e=>setSupplierName(e.target.value)}/>
        <label htmlFor="supplier-contact">Contact person</label><input id="supplier-contact" required value={contactName} onChange={e=>setContactName(e.target.value)}/>
        <label htmlFor="supplier-email">Email</label><input id="supplier-email" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/>
        <label htmlFor="supplier-phone">Phone</label><input id="supplier-phone" required value={phone} onChange={e=>setPhone(e.target.value)}/>
        <button className="button" disabled={busy}>{busy?"Saving…":"Add supplier"}</button>
      </form>
    </section>
    <section className="workspace-section">
      <h2>Add a supplier product</h2>
      <form className="panel-form" onSubmit={addOffer}>
        <label htmlFor="offer-supplier">Supplier</label><select id="offer-supplier" required value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">Choose supplier…</option>{suppliers.filter(s=>s.status==="active").map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <label htmlFor="offer-category">Category</label><input id="offer-category" required value={category} onChange={e=>setCategory(e.target.value)}/>
        <label htmlFor="offer-name">Product name</label><input id="offer-name" required value={name} onChange={e=>setName(e.target.value)}/>
        <label htmlFor="offer-brand">Brand</label><input id="offer-brand" required value={brand} onChange={e=>setBrand(e.target.value)}/>
        <label htmlFor="offer-model">Model</label><input id="offer-model" required value={model} onChange={e=>setModel(e.target.value)}/>
        <label htmlFor="offer-sku">Supplier SKU</label><input id="offer-sku" required value={sku} onChange={e=>setSku(e.target.value)}/>
        <label htmlFor="offer-currency">Currency</label><select id="offer-currency" value={currency} onChange={e=>setCurrency(e.target.value)}>{["UGX","USD","EUR","KES","TZS","RWF"].map(c=><option key={c}>{c}</option>)}</select>
        <label htmlFor="offer-cost">Supplier unit cost</label><input id="offer-cost" type="number" min="0.01" step="any" required value={cost} onChange={e=>setCost(e.target.value)}/>
        <label htmlFor="offer-margin">Selling margin (%)</label><input id="offer-margin" type="number" min="0" max="1000" step="0.01" required value={margin} onChange={e=>setMargin(e.target.value)}/>
        <label htmlFor="offer-floor">Minimum margin (%)</label><input id="offer-floor" type="number" min="0" max="1000" step="0.01" required value={floor} onChange={e=>setFloor(e.target.value)}/>
        <label htmlFor="offer-quantity">Available quantity</label><input id="offer-quantity" type="number" min="0" step="1" required value={quantity} onChange={e=>setQuantity(e.target.value)}/>
        <label htmlFor="offer-minimum">Minimum order quantity</label><input id="offer-minimum" type="number" min="0" step="1" required value={minimum} onChange={e=>setMinimum(e.target.value)}/>
        <label htmlFor="offer-lead">Lead time (days)</label><input id="offer-lead" type="number" min="0" step="1" required value={lead} onChange={e=>setLead(e.target.value)}/>
        <button className="button" disabled={busy||suppliers.length===0}>{busy?"Saving…":"Add to catalogue"}</button>
      </form>
    </section>
    <section className="workspace-section">
      <h2>Consolidated supplier catalogue ({offers.length})</h2>
      {offers.length===0?<p className="muted">No supplier offers yet.</p>:<ul className="record-list">{offers.map(o=><li className="product-card" key={o.id}>
        <div className="field-head"><div><span className="record-title">{o.name}</span><span className="record-meta">{o.brand} {o.model} · {o.sku}</span><span className="record-meta">Supplied by {o.supplierName} · {o.category}</span></div>
        <div className="price-block"><span className="price">{o.currency} {o.sellingPrice}</span><span className="record-meta">{o.availableQuantity} available</span></div></div>
        <span className="record-meta">MOQ {o.minimumOrderQuantity} · lead time {o.leadTimeDays} days</span>
        <div className="record-actions"><button className="button button-secondary button-small" type="button" onClick={()=>void stockMove(o.id,"receipt")}>Receive stock</button><button className="button button-secondary button-small" type="button" onClick={()=>void stockMove(o.id,"issue")}>Issue stock</button></div>
      </li>)}</ul>}
    </section>
  </>;
}
export default function SuppliersPage(){
 return <ConfiguredOnly><CompanyPage title="Supplier inventory" allowedRoles={["super_admin","inventory_admin"]}>{company=><SupplierWorkspace tenantId={company.tenantId}/>}</CompanyPage></ConfiguredOnly>;
}
