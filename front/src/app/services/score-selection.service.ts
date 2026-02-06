import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { CookieService } from 'ngx-cookie-service';

export interface GlobalSettings {
  currentKey: string;
  instruments: string;
  showPositions: boolean;
  zoomLevel: number;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  currentKey: 'Padrão da partitura',
  instruments: '',
  showPositions: true,
  zoomLevel: 0.7
};

export interface SelectedScore {
  id: string;
  name: string;
  xmlContent: string;
  originalXmlContent: string;
  order: number;
  settings: {
    zoomLevel: number;
    currentKey: string;
    showPositions: boolean;
    instrumentVisibility: { [key: string]: boolean };
  };
}

@Injectable({
  providedIn: 'root'
})
export class ScoreSelectionService {
  private dbName = 'ScoreViewerDB';
  private storeName = 'selectedScores';
  private globalSettingsStore = 'globalSettings';
  private db: IDBDatabase | null = null;
  private dbReady: Promise<void>;

  private selectedScoresSubject = new BehaviorSubject<SelectedScore[]>([]);
  public selectedScores$ = this.selectedScoresSubject.asObservable();

  constructor(private cookieService: CookieService) {
    this.dbReady = this.initDB().then(() => this.loadScoresFromDB());
  }

  private initPromise: Promise<void> | null = null;

  private initDB(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 2);

      request.onerror = (event) => {
        console.error('IndexedDB error:', event);
        this.initPromise = null;
        reject();
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(this.globalSettingsStore)) {
          db.createObjectStore(this.globalSettingsStore);
        }
      };
    });

    return this.initPromise;
  }

  private async loadScoresFromDB() {
    if (!this.db) {
      await this.initDB();
    }
    if (!this.db) return;

    const transaction = this.db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);
    const request = store.getAll();

    request.onsuccess = () => {
      let scores = request.result as SelectedScore[];

      // Ordenar exclusivamente pelo campo persistido 'order'
      scores.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      this.selectedScoresSubject.next(scores);
    };
  }

  public async addScore(score: Omit<SelectedScore, 'order'>) {
    console.log('[ScoreSelectionService] Adicionando partitura:', score.id, score.name);
    if (!this.db) {
      await this.initDB();
    }
    if (!this.db) {
      console.error('[ScoreSelectionService] Falha ao inicializar DB');
      return;
    }

    const currentScores = this.selectedScoresSubject.value;
    const newScore: SelectedScore = {
      ...score,
      order: currentScores.length
    };

    const transaction = this.db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);
    store.put(newScore);

    transaction.oncomplete = () => {
      console.log('[ScoreSelectionService] Partitura adicionada com sucesso');
      this.loadScoresFromDB();
    };

    transaction.onerror = (event) => {
      console.error('[ScoreSelectionService] Erro na transação de adição:', event);
    };
  }

  public async updateScoreSettings(id: string, settings: SelectedScore['settings'], xmlContent?: string) {
    console.log('[ScoreSelectionService] Atualizando configurações:', id);
    if (!this.db) {
      await this.initDB();
    }
    if (!this.db) {
      console.error('[ScoreSelectionService] Falha ao inicializar DB');
      return;
    }

    const transaction = this.db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const request = store.get(id);

    request.onsuccess = () => {
      const score = request.result as SelectedScore;
      if (score) {
        score.settings = { ...score.settings, ...settings };
        if (xmlContent) {
          score.xmlContent = xmlContent;
        }
        store.put(score);
        console.log('[ScoreSelectionService] Configurações atualizadas no store');
      } else {
        console.warn('[ScoreSelectionService] Partitura não encontrada para atualização:', id);
      }
    };

    transaction.oncomplete = () => {
      console.log('[ScoreSelectionService] Transação de atualização completa');
      this.loadScoresFromDB();
    };

    transaction.onerror = (event) => {
      console.error('[ScoreSelectionService] Erro na transação de atualização:', event);
    };
  }

  public async removeScores(ids: string[]) {
    if (!this.db) {
      await this.initDB();
    }
    if (!this.db) return;

    const transaction = this.db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);

    ids.forEach(id => store.delete(id));

    transaction.oncomplete = () => {
      this.loadScoresFromDB();
      this.updateOrderCookie();
    };
  }

  public async resetScore(id: string) {
    if (!this.db) {
      await this.initDB();
    }
    if (!this.db) return;

    const transaction = this.db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const request = store.get(id);

    request.onsuccess = () => {
      const score = request.result as SelectedScore;
      if (score) {
        score.xmlContent = score.originalXmlContent;
        score.settings = {
          zoomLevel: undefined as any,
          currentKey: '',
          showPositions: undefined as any,
          instrumentVisibility: {}
        };
        store.put(score);
      }
    };

    transaction.oncomplete = () => {
      this.loadScoresFromDB();
    };
  }

  public async updateOrder(scores: SelectedScore[]) {
    if (!this.db) {
      await this.initDB();
    }
    if (!this.db) return;

    // Atualiza o campo 'order' de todos os registros no IndexedDB conforme a nova sequência
    const tx = this.db.transaction([this.storeName], 'readwrite');
    const store = tx.objectStore(this.storeName);

    scores.forEach((score, index) => {
      const updated: SelectedScore = { ...score, order: index };
      store.put(updated);
    });

    tx.oncomplete = () => {
      this.loadScoresFromDB();
    };
  }

  public async getGlobalSettings(): Promise<GlobalSettings> {
    if (!this.db) {
      await this.initDB();
    }
    if (!this.db) return DEFAULT_GLOBAL_SETTINGS;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([this.globalSettingsStore], 'readonly');
      const store = transaction.objectStore(this.globalSettingsStore);
      const request = store.get('current');

      request.onsuccess = () => {
        resolve(request.result || DEFAULT_GLOBAL_SETTINGS);
      };
      request.onerror = () => {
        resolve(DEFAULT_GLOBAL_SETTINGS);
      };
    });
  }

  public async saveGlobalSettings(settings: GlobalSettings): Promise<void> {
    if (!this.db) {
      await this.initDB();
    }
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.globalSettingsStore], 'readwrite');
      const store = transaction.objectStore(this.globalSettingsStore);
      const request = store.put(settings, 'current');

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public async updateOrderCookie() {
    const orderArray = this.selectedScoresSubject.value.map(s => s.id);
    this.cookieService.set('scores_order', JSON.stringify(orderArray), 30);
  }
}
