# CryptoEdge Pro — App Nativo (Capacitor)

## Pré-requisitos
- Node.js 18+
- Para iOS: Mac com Xcode 14+
- Para Android: Android Studio + JDK 17

## Build em 5 passos

### Android
```bash
cd capacitor
npm install
# Copiar PWA compilado para /public (já existe)
npx cap add android
npx cap sync android
npx cap open android
# No Android Studio: Build → Generate Signed Bundle/APK
```

### iOS (Mac apenas)
```bash
cd capacitor
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
# No Xcode: Product → Archive → Distribute App
```

## Configuração de Push Notifications

### Android (Firebase)
1. Crie projeto no Firebase Console
2. Baixe `google-services.json`
3. Cole em `android/app/google-services.json`
4. Configure VAPID no EasyPanel:
   ```
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   ```

### iOS (Apple Push)
1. Crie APNs Key no Apple Developer
2. Configure no Firebase Console
3. Adicione entitlement `aps-environment` no Xcode

## App Store Checklist
- [ ] Screenshots 6.7" + 5.5" + iPad Pro
- [ ] Ícones 1024×1024 (já temos icon-512.png)
- [ ] Privacy Policy URL
- [ ] Descrição em PT-BR e EN
- [ ] Categoria: Finance
- [ ] Age Rating: 4+

## Google Play Checklist
- [ ] Keystore gerado e salvo com segurança
- [ ] Screenshots phone + tablet
- [ ] Feature graphic 1024×500
- [ ] Política de privacidade
