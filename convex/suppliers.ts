import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { validateCurrency, requireText } from "./lib/validation";

const MANAGERS = ["super_admin", "inventory_admin"] as const;
const STAFF_ROLE = v.union(
  v.literal("inventory_admin"),
  v.literal("sales_manager"),
  v.literal("technician"),
  v.literal("sales_agent")
);

export const listSuppliers = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId);
    const rows = await ctx.db.query("supplierCompanies")
      .withIndex("by_tenant", q => q.eq("tenantId", args.tenantId)).collect();
    return rows.sort((a,b) => a.name.localeCompare(b.name)).map(s => ({
      id:s._id, name:s.name, contactName:s.contactName, email:s.email,
      phone:s.phone, address:s.address ?? "", status:s.status
    }));
  }
});

export const createSupplier = mutation({
  args: {
    tenantId:v.id("tenants"), name:v.string(), registrationNumber:v.optional(v.string()),
    contactName:v.string(), email:v.string(), phone:v.string(), address:v.optional(v.string())
  },
  handler: async (ctx,args) => {
    const {profile}=await requireTenantMembership(ctx,args.tenantId,MANAGERS);
    const name=requireText(args.name,"Supplier name",120);
    const email=args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ConvexError("Enter a valid supplier email.");
    const id=await ctx.db.insert("supplierCompanies",{
      tenantId:args.tenantId,name,registrationNumber:args.registrationNumber?.trim() || undefined,
      contactName:requireText(args.contactName,"Contact name",100),email,
      phone:requireText(args.phone,"Phone",40),address:args.address?.trim() || undefined,
      status:"active",createdAt:Date.now(),updatedAt:Date.now(),createdBy:profile.authSubject
    });
    await recordAudit(ctx,profile,{tenantId:args.tenantId,action:"supplier.created",entityType:"supplierCompanies",entityId:id,summary:`Supplier ${name} created.`});
    return {supplierId:id};
  }
});

export const listSupplierOffers = query({
  args: { tenantId:v.id("tenants"), supplierId:v.optional(v.id("supplierCompanies")) },
  handler: async (ctx,args) => {
    const {membership,tenant}=await requireTenantMembership(ctx,args.tenantId);
    const rows=args.supplierId
      ? await ctx.db.query("supplierOffers").withIndex("by_supplier",q=>q.eq("supplierId",args.supplierId!)).collect()
      : await ctx.db.query("supplierOffers").withIndex("by_tenant",q=>q.eq("tenantId",args.tenantId)).collect();
    const suppliers=new Map();
    const admin=membership.role==="super_admin" || membership.role==="inventory_admin";
    return Promise.all(rows.filter(o=>o.tenantId===args.tenantId && o.status==="active").map(async o=>{
      if (!suppliers.has(o.supplierId)) suppliers.set(o.supplierId,await ctx.db.get(o.supplierId));
      const supplier=suppliers.get(o.supplierId);
      const listMinor=Math.round(o.unitCostMinor*(1+o.marginBps/10000));
      return {
        id:o._id,supplierId:o.supplierId,supplierName:supplier?.name ?? "Supplier",
        category:o.category,name:o.name,brand:o.brand,model:o.model,sku:o.supplierSku,
        description:o.description ?? "",specifications:o.specifications ?? {},
        currency:o.currency,sellingPriceMinor:listMinor,availableQuantity:o.availableQuantity,
        minimumOrderQuantity:o.minimumOrderQuantity,leadTimeDays:o.leadTimeDays,
        costMinor:admin?o.unitCostMinor:null,marginBps:admin?o.marginBps:null,
        floorMarginBps:admin?o.floorMarginBps:null,
        isLocalCurrency:o.currency===tenant.defaultCurrency
      };
    }));
  }
});

export const createSupplierOffer = mutation({
  args:{
    tenantId:v.id("tenants"),supplierId:v.id("supplierCompanies"),category:v.string(),
    name:v.string(),brand:v.string(),model:v.string(),supplierSku:v.string(),
    description:v.optional(v.string()),
    specifications:v.optional(v.record(v.string(),v.union(v.number(),v.string(),v.boolean()))),
    currency:v.string(),unitCost:v.number(),marginPercent:v.number(),floorMarginPercent:v.number(),
    availableQuantity:v.number(),minimumOrderQuantity:v.number(),leadTimeDays:v.number()
  },
  handler:async(ctx,args)=>{
    const {profile,tenant}=await requireTenantMembership(ctx,args.tenantId,MANAGERS);
    const supplier=await ctx.db.get(args.supplierId);
    if(!supplier || supplier.tenantId!==args.tenantId || supplier.status!=="active") throw new ConvexError("Active supplier not found.");
    const currency=validateCurrency(args.currency);
    if(!tenant.supportedCurrencies.includes(currency)) throw new ConvexError(`${currency} is not enabled for this company.`);
    if(!Number.isFinite(args.unitCost)||args.unitCost<=0) throw new ConvexError("Unit cost must be greater than zero.");
    if(args.marginPercent<0||args.floorMarginPercent<0||args.floorMarginPercent>args.marginPercent||args.marginPercent>1000) throw new ConvexError("Check the margin and floor margin values.");
    for(const [label,value] of [["available quantity",args.availableQuantity],["minimum order quantity",args.minimumOrderQuantity],["lead time",args.leadTimeDays]] as const){
      if(!Number.isInteger(value)||value<0) throw new ConvexError(`Invalid ${label}.`);
    }
    const sku=requireText(args.supplierSku,"Supplier SKU",40).toUpperCase();
    const existing=await ctx.db.query("supplierOffers").withIndex("by_supplier_sku",q=>q.eq("supplierId",supplier._id).eq("supplierSku",sku)).unique();
    if(existing) throw new ConvexError("That supplier SKU already exists.");
    const unitCostMinor=Math.round(args.unitCost*100);
    const offerId=await ctx.db.insert("supplierOffers",{
      tenantId:args.tenantId,supplierId:supplier._id,category:requireText(args.category,"Category",80),
      name:requireText(args.name,"Product name",120),brand:requireText(args.brand,"Brand",80),
      model:requireText(args.model,"Model",80),supplierSku:sku,description:args.description?.trim()||undefined,
      specifications:args.specifications,currency,unitCostMinor,
      marginBps:Math.round(args.marginPercent*100),floorMarginBps:Math.round(args.floorMarginPercent*100),
      availableQuantity:args.availableQuantity,minimumOrderQuantity:args.minimumOrderQuantity,
      leadTimeDays:args.leadTimeDays,status:"active",createdAt:Date.now(),updatedAt:Date.now(),createdBy:profile.authSubject
    });
    await ctx.db.insert("supplierStockMovements",{
      tenantId:args.tenantId,supplierId:supplier._id,offerId,type:"receipt",
      quantity:args.availableQuantity,balanceAfter:args.availableQuantity,
      idempotencyKey:`initial:${offerId}`,actorUserId:profile._id,createdAt:Date.now()
    });
    await recordAudit(ctx,profile,{tenantId:args.tenantId,action:"supplier_offer.created",entityType:"supplierOffers",entityId:offerId,summary:`Supplier offer ${sku} created for ${supplier.name}.`});
    return {offerId};
  }
});

export const adjustSupplierStock = mutation({
  args:{
    tenantId:v.id("tenants"),offerId:v.id("supplierOffers"),
    type:v.union(v.literal("receipt"),v.literal("issue"),v.literal("adjustment")),
    quantity:v.number(),reason:v.string(),reference:v.optional(v.string()),idempotencyKey:v.string()
  },
  handler:async(ctx,args)=>{
    const {profile}=await requireTenantMembership(ctx,args.tenantId,MANAGERS);
    const offer=await ctx.db.get(args.offerId);
    if(!offer || offer.tenantId!==args.tenantId) throw new ConvexError("Supplier offer not found.");
    const key=requireText(args.idempotencyKey,"Operation key",100);
    const duplicate=await ctx.db.query("supplierStockMovements")
      .withIndex("by_tenant_key",q=>q.eq("tenantId",args.tenantId).eq("idempotencyKey",key)).unique();
    if(duplicate) return {balance:duplicate.balanceAfter,replayed:true};
    if(!Number.isInteger(args.quantity)||args.quantity===0) throw new ConvexError("Stock movement must be a non-zero whole number.");
    const delta=args.type==="receipt"?Math.abs(args.quantity):args.type==="issue"?-Math.abs(args.quantity):args.quantity;
    const balance=offer.availableQuantity+delta;
    if(balance<0) throw new ConvexError("This movement would make supplier stock negative.");
    await ctx.db.patch(offer._id,{availableQuantity:balance,updatedAt:Date.now()});
    await ctx.db.insert("supplierStockMovements",{
      tenantId:args.tenantId,supplierId:offer.supplierId,offerId:offer._id,type:args.type,
      quantity:delta,balanceAfter:balance,reason:requireText(args.reason,"Reason",300),
      reference:args.reference?.trim()||undefined,idempotencyKey:key,actorUserId:profile._id,createdAt:Date.now()
    });
    await recordAudit(ctx,profile,{tenantId:args.tenantId,action:"supplier_stock.adjusted",entityType:"supplierOffers",entityId:offer._id,summary:`Supplier stock changed by ${delta}; balance ${balance}.`});
    return {balance,replayed:false};
  }
});

export const setSupplierStatus = mutation({
  args:{tenantId:v.id("tenants"),supplierId:v.id("supplierCompanies"),status:v.union(v.literal("active"),v.literal("inactive"))},
  handler:async(ctx,args)=>{
    const {profile}=await requireTenantMembership(ctx,args.tenantId,MANAGERS);
    const supplier=await ctx.db.get(args.supplierId);
    if(!supplier||supplier.tenantId!==args.tenantId) throw new ConvexError("Supplier not found.");
    await ctx.db.patch(supplier._id,{status:args.status,updatedAt:Date.now()});
    if(args.status==="inactive"){
      const offers=await ctx.db.query("supplierOffers").withIndex("by_supplier",q=>q.eq("supplierId",supplier._id)).collect();
      for(const offer of offers) await ctx.db.patch(offer._id,{status:"inactive",updatedAt:Date.now()});
    }
    await recordAudit(ctx,profile,{tenantId:args.tenantId,action:"supplier.status_changed",entityType:"supplierCompanies",entityId:supplier._id,summary:`Supplier ${supplier.name} marked ${args.status}.`});
    return {ok:true};
  }
});
