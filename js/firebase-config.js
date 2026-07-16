(function(){
  const firebaseConfig = {
    apiKey: "AIzaSyBlii0svzXc6OvL49P06e8TgFF4QrzyXm0",
    authDomain: "viber2ddesk.firebaseapp.com",
    projectId: "viber2ddesk",
    storageBucket: "viber2ddesk.firebasestorage.app",
    messagingSenderId: "98470658215",
    appId: "1:98470658215:web:28475a9afc8f1f85695b82"
  };

  window.V2D_FIREBASE_CONFIG = firebaseConfig;

  try{
    if(!window.firebase) throw new Error("Firebase SDK မရောက်သေးပါ");
    if(!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    window.v2dDb = firebase.firestore();
    window.v2dPersistenceReady = window.v2dDb.enablePersistence({synchronizeTabs:true}).catch(error=>{
      if(error?.code==='failed-precondition'){
        console.warn('Firestore persistence: multiple tabs are open; online sync will continue',error);
      }else if(error?.code==='unimplemented'){
        console.warn('Firestore persistence is not supported in this browser; online sync will continue',error);
      }else{
        console.warn('Firestore persistence warning',error);
      }
      return false;
    });
    window.v2dAuth = firebase.auth();
  }catch(error){
    console.error("Firebase initialization failed", error);
    window.v2dFirebaseInitError = error;
  }
})();
