/**
 * Script to update merchant logos with Google Favicon URLs
 * Run with: npx tsx scripts/update-merchant-logos.ts
 */
import { db } from "../server/db";
import { merchants } from "../shared/schema";
import { eq } from "drizzle-orm";

// Helper to get Google favicon URL
const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

// High-quality direct logo URLs (using Logo.dev API for reliable high-res logos)
// Logo.dev provides free, high-quality company logos
// SECURITY: Token must be set via environment variable
const LOGO_DEV_TOKEN = process.env.LOGO_DEV_TOKEN;
if (!LOGO_DEV_TOKEN) {
  console.error("ERROR: LOGO_DEV_TOKEN environment variable is required");
  console.error("Set it with: export LOGO_DEV_TOKEN=your_token_here");
  process.exit(1);
}
const logo = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&size=200&format=png`;

const merchantLogos: Record<string, string> = {
  // Supermarkets - High quality logos
  "Pick n Pay": logo("picknpay.co.za"),
  "Shoprite": logo("shoprite.co.za"),
  "Game Stores": logo("game.co.za"),
  "Spar": logo("spar.co.za"),
  "Choppies": logo("choppies.co.bw"),
  "Food Lovers Market": logo("foodloversmarket.co.za"),
  
  // Fast Food - High quality logos
  "Hungry Lion": logo("hungrylion.co.za"),
  "Debonairs Pizza": logo("debonairs.co.za"),
  "Steers": logo("steers.co.za"),
  "Nando's": logo("nandos.com"),
  "KFC": logo("kfc.com"),
  "Ocean Basket": logo("oceanbasket.com"),
  "Mugg & Bean": logo("muggandbean.co.za"),
  "Wimpy": logo("wimpy.co.za"),
  
  // Fuel Stations - High quality logos
  "Puma Energy": logo("pumaenergy.com"),
  "Total Energies": logo("totalenergies.com"),
  "Engen": logo("engen.co.za"),
  "Kobil": logo("kobil.com"),
  "Mount Meru": logo("mountmerupetroleum.com"),
  
  // Banks - High quality logos
  "Zanaco": logo("zanaco.co.zm"),
  "Stanbic Bank": logo("stanbicbank.co.zm"),
  "FNB Zambia": logo("fnbzambia.co.zm"),
  "Standard Chartered": logo("sc.com"),
  "Absa Bank": logo("absa.co.za"),
  "Atlas Mara": logo("atlasmara.com"),
  
  // Telecom - High quality logos
  "MTN Zambia": logo("mtn.co.zm"),
  "Airtel Zambia": logo("airtel.co.zm"),
  "Zamtel": logo("zamtel.co.zm"),
  "Liquid Telecom": logo("liquid.tech"),
  
  // Utilities - High quality logos
  "ZESCO": logo("zesco.co.zm"),
  "DSTV Zambia": logo("dstv.com"),
  "GOtv Zambia": logo("gotvafrica.com"),
  "Lusaka Water": logo("lwsc.com.zm"),
  
  // Pharmacies - High quality logos
  "Link Pharmacy": logo("linkpharmacy.co.zm"),
  "Clicks": logo("clicks.co.za"),
  "Dis-Chem": logo("dischem.co.za"),
  
  // Retail - High quality logos
  "Pep Stores": logo("pepstores.com"),
  "Jet Stores": logo("jet.co.za"),
  "Mr Price": logo("mrprice.com"),
  "Edgars": logo("edgars.co.za"),
  "Woolworths": logo("woolworths.co.za"),
  "Truworths": logo("truworths.co.za"),
  "Ackermans": logo("ackermans.co.za"),
  
  // Electronics
  "Incredible Connection": logo("incredible.co.za"),
  "Matrix Warehouse": logo("matrixwarehouse.co.za"),
  
  // Hardware
  "Build It": logo("buildit.co.za"),
  "Builders Warehouse": logo("builders.co.za"),
  "Cashbuild": logo("cashbuild.co.za"),
  
  // Education
  "UNZA": logo("unza.zm"),
  "CBU": logo("cbu.ac.zm"),
  
  // Transport
  "Yango Zambia": logo("yango.com"),
  "Proflight Zambia": logo("proflight-zambia.com"),
  
  // Digital Services - High quality logos
  "Netflix": logo("netflix.com"),
  "Spotify": logo("spotify.com"),
  "Apple": logo("apple.com"),
  "Google": logo("google.com"),
  "Amazon": logo("amazon.com"),
};

async function updateMerchantLogos() {
  console.log("Updating merchant logos with high-quality images...\n");
  
  // Get all merchants
  const allMerchants = await db.select().from(merchants);
  
  let updated = 0;
  for (const merchant of allMerchants) {
    const logoUrl = merchantLogos[merchant.name];
    if (logoUrl) {
      await db
        .update(merchants)
        .set({ logoUrl })
        .where(eq(merchants.id, merchant.id));
      console.log(`✅ ${merchant.name}`);
      updated++;
    } else {
      // Use Google favicon as fallback
      const fallbackUrl = favicon(merchant.name.toLowerCase().replace(/\s+/g, '') + ".com");
      await db
        .update(merchants)
        .set({ logoUrl: fallbackUrl })
        .where(eq(merchants.id, merchant.id));
      console.log(`⏭️  ${merchant.name} - using fallback`);
    }
  }
  
  console.log(`\n✅ Updated ${updated} merchants with high-quality logo URLs`);
  process.exit(0);
}

updateMerchantLogos().catch(console.error);
