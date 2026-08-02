Viber 2D Desk — Stage 5.0A.3.6 Final Stable + PWA Audit
============================================================

ဒီ Package က GitHub Pages တင်နိုင်သော Full Project ဖြစ်ပါတယ်။

အဓိက Final Audit ပြင်ဆင်ချက်
- App/Auth/Firebase Bootstrap/PWA/Service Worker/Cloud metadata version = 5.0A.3.6
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
css/stage-5.0A.3.6.css
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
