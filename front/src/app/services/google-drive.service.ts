import { Injectable } from '@angular/core';
import { CookieService } from 'ngx-cookie-service';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface GoogleDriveConfig {
  userEmail?: string;
  defaultFolderId?: string;
  defaultFolderName?: string;
}

const CLIENT_ID = environment.googleCredentials.client_id;
const API_KEY: string = (environment.googleCredentials as any).apiKey || '';

declare const gapi: any;
declare const google: any;

@Injectable({
  providedIn: 'root'
})
export class GoogleDriveService {
  private readonly COOKIE_NAME = 'google_drive_account';
  private readonly COOKIE_EXPIRY_DAYS = 15;
  private readonly SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email';
  private readonly DRIVE_API_URL = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';

  private config: GoogleDriveConfig | null = null;
  private accessToken: string | null = null;
  private tokenClient: any;
  private initPromise: Promise<void> | null = null;
  private isInitialized = new BehaviorSubject<boolean>(false);

  constructor(private cookieService: CookieService) {
    this.loadConfigFromCookie();
    // Lazy: não inicializa scripts do Google no construtor
  }

  // --- Inicialização ---

  private initGoogleEcosystem(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise(async (resolve, reject) => {
      try {
        console.log('🔧 [GoogleDrive] Carregando scripts...');

        await Promise.all([
          this.loadScript('https://apis.google.com/js/api.js', 'gapi', () => !!(window as any)['gapi']),
          this.loadScript('https://accounts.google.com/gsi/client', 'gis', () => !!(window as any)['google'])
        ]);

        await new Promise<void>((res, rej) => gapi.load('client', { callback: res, onerror: rej }));

        const initConfig: any = {};
        if (API_KEY && API_KEY.length > 10) {
          initConfig.apiKey = API_KEY;
        }
        await gapi.client.init(initConfig);
        console.log('✅ [GoogleDrive] GAPI Client Base pronto.');

        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: this.SCOPES,
          callback: (resp: any) => this.handleTokenResponse(resp),
        });
        console.log('✅ [GoogleDrive] GIS Token Client pronto.');

        try {
          await gapi.client.load(this.DRIVE_API_URL);
          console.log('✅ [GoogleDrive] API Drive carregada.');
        } catch (e) {
          console.warn('⚠️ [GoogleDrive] API Drive falhou (provável 403). Tentaremos após login.');
        }

        this.isInitialized.next(true);
        resolve();

      } catch (error) {
        console.error('❌ [GoogleDrive] Erro fatal:', error);
        this.initPromise = null;
        reject(error);
      }
    });

    return this.initPromise;
  }

  // --- Auth & Logout ---

// --- Auth & Logout ---

  /**
   * Realiza login.
   * @param forceAccountSelect Se true, força a tela de escolha de conta.
   */
  async login(forceAccountSelect: boolean = false): Promise<void> {
    // Garante que o ecossistema está carregado
    if (!this.initPromise) await this.initGoogleEcosystem();
    else await this.initPromise;

    return new Promise((resolve, reject) => {
      const originalCallback = this.tokenClient.callback;

      this.tokenClient.callback = async (resp: any) => {
        // Restaura callback original
        this.tokenClient.callback = originalCallback || this.handleTokenResponse.bind(this);

        if (resp.error) {
          // Se o usuário fechou o popup ou deu erro
          console.error('Erro no login:', resp);
          reject(resp);
          return;
        }

        await this.handleTokenResponse(resp);
        resolve();
      };

      // Configuração do prompt
      // 'select_account' força o Google a mostrar a lista de contas
      // 'consent' força a tela de permissão (útil para primeiro login)
      let prompt = '';

      if (forceAccountSelect) {
        prompt = 'select_account';
      } else if (!this.accessToken) {
        prompt = 'consent';
      }

      // IMPORTANTE: Skip prompt se já temos token e não é para forçar troca
      // Isso evita popups desnecessários em reloads
      this.tokenClient.requestAccessToken({ prompt: prompt });
    });
  }

  /**
   * Realiza Logout LOCAL.
   * Apenas limpa os dados da aplicação. Não revoga no servidor do Google
   * para evitar o erro de "App não seguro" ao tentar relogar imediatamente.
   */
  logout(): void {
    // 1. Limpar estado da classe
    this.accessToken = null;
    this.config = null;

    // 2. Limpar GAPI (Importante para remover o header Authorization das próximas requisições)
    if (typeof gapi !== 'undefined' && gapi.client) {
      gapi.client.setToken(null);
    }

    // 3. Limpar Cookies
    this.cookieService.delete(this.COOKIE_NAME, '/');

    console.log('🔒 [GoogleDrive] Sessão local limpa.');
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  private async handleTokenResponse(resp: any) {
    this.accessToken = resp.access_token;
    gapi.client.setToken({ access_token: this.accessToken });
    await this.fetchUserEmail(this.accessToken!);
  }

  private async fetchUserEmail(token: string): Promise<void> {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.email) this.saveConfig({ userEmail: data.email });
    } catch (e) { console.warn('Ignorando erro ao buscar email', e); }
  }

  // --- Métodos de Arquivos ---

  async listFiles(folderId: string = 'root'): Promise<any[]> {
    await this.initGoogleEcosystem();

    if (!this.accessToken) {
      console.log('🔒 [GoogleDrive] Token ausente. Iniciando login...');
      await this.login();
    }

    try {
      if (!gapi.client.drive) await gapi.client.load(this.DRIVE_API_URL);

      const response = await gapi.client.drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, size, modifiedTime)',
        pageSize: 100,
        orderBy: 'folder,name'
      });

      return (response.result.files || []).map((file: any) => ({
        id: file.id,
        name: file.name,
        type: file.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
        extension: file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '',
        size: file.size,
        modified: new Date(file.modifiedTime)
      }));
    } catch (error: any) {
      // Se der erro 401, tenta renovar (pode ser token expirado)
      if (error.status === 401 || (error.result && error.result.error.code === 401)) {
        console.log('🔄 [GoogleDrive] Token expirado. Renovando...');
        this.accessToken = null;
        await this.login(); // Tenta login normal
        return this.listFiles(folderId);
      }
      throw error;
    }
  }

  async getFolderName(folderId: string): Promise<string> {
    if (folderId === 'root') return 'Meu Drive';
    await this.initGoogleEcosystem();
    if (!this.accessToken) await this.login();
    try {
      if (!gapi.client.drive) await gapi.client.load(this.DRIVE_API_URL);
      const response = await gapi.client.drive.files.get({ fileId: folderId, fields: 'name' });
      return response.result.name;
    } catch (error) { return 'Pasta Desconhecida'; }
  }

  async getFileContent(fileId: string): Promise<string> {
    await this.initGoogleEcosystem();
    if (!this.accessToken) await this.login();
    try {
      if (!gapi.client.drive) await gapi.client.load(this.DRIVE_API_URL);
      const response = await gapi.client.drive.files.get({ fileId: fileId, alt: 'media' });
      return response.body;
    } catch (err: any) {
      if (err.status === 401) {
        this.accessToken = null;
        await this.login();
        return this.getFileContent(fileId);
      }
      throw err;
    }
  }

  // --- Helpers ---

  private loadScript(src: string, id: string, checkGlobal: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.getElementById(id) && checkGlobal()) { resolve(); return; }
      const existing = document.getElementById(id);
      if (existing) existing.remove();
      const script = document.createElement('script');
      script.id = id; script.src = src; script.async = true; script.defer = true;
      script.onload = () => { setTimeout(() => { if (checkGlobal()) resolve(); else reject(new Error(`Script ${id} falhou`)); }, 50); };
      script.onerror = () => reject(new Error(`Erro rede ${src}`));
      document.head.appendChild(script);
    });
  }

  private loadConfigFromCookie(): void {
    const saved = this.cookieService.get(this.COOKIE_NAME);
    if (saved) { try { this.config = JSON.parse(saved); } catch {} }
  }

  saveConfig(config: GoogleDriveConfig): void {
    this.config = { ...this.config, ...config };
    this.cookieService.set(this.COOKIE_NAME, JSON.stringify(this.config), this.COOKIE_EXPIRY_DAYS, '/');
  }

  getConfig(): GoogleDriveConfig | null { return this.config; }
}
