import webpush from 'web-push';
const keys=webpush.generateVAPIDKeys();
console.log('Render Environment에 아래 값을 등록하세요. PRIVATE_KEY를 공개하거나 Git에 저장하지 마세요.');
console.log('VAPID_PUBLIC_KEY='+keys.publicKey);
console.log('VAPID_PRIVATE_KEY='+keys.privateKey);
