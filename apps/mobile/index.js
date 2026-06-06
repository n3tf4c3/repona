// Entry point local (monorepo): o pacote `expo` é içado para o node_modules da
// raiz, então o AppEntry padrão (expo/AppEntry.js) resolveria `../../App` para a
// raiz do monorepo em vez de apps/mobile. Registramos a App explicitamente daqui.
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
