Viber 2D Desk — Stage 5.0A.4.1.7 Adaptive OCR Memory + Final UI Polish
============================================================

ဒီ Package က GitHub Pages တင်နိုင်သော Full Project ဖြစ်ပါတယ်။

အဓိက Final Audit ပြင်ဆင်ချက်
- App/Auth/Firebase Bootstrap/PWA/Service Worker/Cloud metadata version = 5.0A.4.1.7
- Service Worker cache version အသစ်ဖြင့် အဟောင်း cache များဖယ်ရှားမည်
- Offline App Shell ထဲ stage CSS နှင့် icon files အားလုံးထည့်ထားသည်
- Manifest လိုအပ်သော icon-192, icon-512, maskable icon ပါဝင်သည်
- Tested Stage 5.0A.3.5 runtime logic ကို မပြောင်းဘဲ release metadata/PWA packaging ကိုသာ clean up လုပ်ထားသည်
- dev.html နှင့် app_backup file ကို Production root ထဲ မထည့်ထားပါ

Project Structure
index.html
manifest.webmanifest
service-worker.js
firestore.rules
css/styles.css
css/stage-5.0A.4.1.7.css
js/app.js
js/auth.js
js/firebase-bootstrap.js
js/firebase-config.js
js/pwa.js
icons/*

Local Test
1. Folder ကို VS Code ဖြင့်ဖွင့်ပါ။
2. index.html ကို Live Server ဖြင့်ဖွင့်ပါ။
3. Ctrl + Shift + R လုပ်ပါ။
4. Console တွင် red error မရှိကြောင်း စစ်ပါ။
5. Copy/Paste, Preview, Save, Refresh, OCR, Report, Owner pages စမ်းပါ။

GitHub Pages
- Repository root ထဲရှိ အဟောင်းဖိုင်များကို backup လုပ်ပါ။
- ဒီ Package အတွင်းရှိ folder/file structure အတိုင်း upload/replace လုပ်ပါ။
- firestore.rules ကို GitHub Pages မသုံးပါ။ Firebase Console rules reference အဖြစ်သာထားပါ။
- Deploy ပြီး 1–3 မိနစ်စောင့်၍ Ctrl + Shift + R လုပ်ပါ။

Known Non-blocking Warning
- Firebase compat persistence API deprecation warning ကျန်နိုင်သည်။ App error မဟုတ်ပါ။
  Modular Firestore migration ကို သီးခြား maintenance stage ဖြင့်သာလုပ်သင့်သည်။

Safety
- Firebase config API key က web client configuration ဖြစ်သည်။ လုံခြုံရေးကို Firestore Rules က ထိန်းချုပ်သည်။
- OCR Queue ပုံများသည် Browser IndexedDB local storage ထဲသာရှိပြီး Cloud Backup မပါပါ။


STAGE 5.0A.4.1.7 — ADAPTIVE OCR CORRECTION MEMORY
================================================
- Tesseract OCR Model ကို အလိုအလျောက် Train မလုပ်ပါ။
- Manual Fix ပြီး Recheck လုပ်သည့် ပြင်ဆင်မှု Pattern ကို User/Browser အလိုက် Local Storage မှတ်မည်။
- တူညီသော ပြင်ဆင်မှုကို ၃ ကြိမ် အတည်ပြုပြီးမှ Suggestion ပြမည်။
- Suggestion ကို အလိုအလျောက် Apply မလုပ်ပါ။ User ရွေးပြီး Apply & Recheck လုပ်မှသာ ပြောင်းမည်။
- Writer A/B/C/AUTO အလိုက် Memory ခွဲထားသည်။
- Bad Rule ကို Reject / Disable / Delete လုပ်နိုင်သည်။
- Memory JSON Export / Import လုပ်နိုင်သည်။
- Firestore Reads/Writes မသုံးပါ။ Device/Browser Local သာဖြစ်သည်။


STAGE 5.0A.4.1.7 — FINAL UI POLISH
- Button size, spacing, contrast and keyboard focus were standardized.
- Entry Copy/Paste and Preview hierarchy was strengthened.
- OCR Queue, Confidence, Issue Routing and Adaptive Memory controls were clarified.
- Dark/Light themes and laptop/mobile layouts were polished.
- Parser, OCR, Correction Memory, Firebase, IndexedDB and license logic were not changed.


ထပ်မံပြင်ဆင်ချက် (5.0A.4.1.7)
- OCR ပုံ Preview ကို ပိုကြီးအောင်ပြင်ထားသည်။
- OCR Preview / Manual Fix စာအကွက်ကို ပိုမြင်သာပြီး စာကြောင်းကြီးကြီးနဲ့ဖတ်ရလွယ်အောင်ပြင်ထားသည်။
- Laptop screen မှာ Queue ကို ဘယ်ဘက်၊ ပုံကြီးနဲ့ စာပြင်တဲ့နေရာကို ညာဘက်တွင် ပိုရှင်းအောင်ပြထားသည်။


Stage 5.0A.4.1.7 — Report Mobile Download Limit
- Report Page ရှိ Mobile JPG download များကို User click တစ်ကြိမ်လျှင် အများဆုံး ၂ ပုံသာ Download လုပ်သည်။
- ပုံ ၂ ပုံထက်ပိုပါက တူညီသော Mobile JPG action/Button ကို ထပ်နှိပ်ပြီး နောက် batch ကို ဆက်ယူနိုင်သည်။
- Data ကို မဖြတ်ပစ်ဘဲ အစဉ်လိုက် ဆက် Download လုပ်ပေးသည်။


Stage 5.0A.4.1.7 — Mobile Report Data အပြည့်အစုံ (အများဆုံး ၂ ပုံ)
- Report Page Mobile Download မှ Data အားလုံးကို ဖြတ်တောက်ခြင်းမရှိဘဲ ၁ ပုံ သို့မဟုတ် ၂ ပုံရှည်အဖြစ် စုစည်းပေးသည်။
- Button ထပ်နှိပ်၍ နောက် Page ယူစရာမလိုပါ။
- Name အားလုံး၏ Card Report Data ကိုပါ အများဆုံး ၂ ပုံအတွင်း ထုတ်ပေးသည်။


Stage 5.0A.4.1.7 — Mobile report single long image
- Mobile Report Download now outputs one long JPG only.
- Repeated top summary block is shown once at the top of the first page only; inner page headers/footers are cropped during merge.
- Full data is preserved; phone users can scroll the long image.


Stage 5.0A.4.1.7 — Stable Card Number + Original Viber Time
- Card numbers are gap-free per Name / Date / Session.
- Deleting Card #N makes the next card take #N; later cards move up automatically.
- Card numbering follows the original Viber message time, not save/edit time.
- Editing a card preserves its original Viber time and original header timestamp.
- Existing records are normalized automatically after update.


STAGE 5.0A.4.1.7 — ENTRY UI RESTORE
- Entry Page UI ကို Stage 5.0A.4.1.4 ပုံစံအတိုင်း ပြန်ထားသည်။
- Stage 5.0A.4.1.6 မှ ထပ်ထည့်ထားသော Entry/Card UI override များကို မသုံးတော့ပါ။
- Card Number gap-free reorder နှင့် Original Viber Time preserve logic ကို ဆက်ထိန်းထားသည်။
- dev.html ကို index.html နှင့် တစ်ပုံစံတည်း synchronize လုပ်ထားသည်။ Local Test မှာ dev.html ဖွင့်သော်လည်း old UI မပေါ်တော့ပါ။
