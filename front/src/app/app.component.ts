import {AfterViewInit, Component, ElementRef, OnInit, ViewChild} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {ToolbarComponent} from './components/toolbar/toolbar.component';
import {FileExplorerComponent} from './components/file-explorer/file-explorer.component';
import {ScoreLoaderService} from './services/score-loader.service';
import {TrombonePositionService} from './services/trombone-position.service';
import {GoogleDriveService} from './services/google-drive.service';
import {ScoreSelectionService, SelectedScore} from './services/score-selection.service';

import {ToastModule} from 'primeng/toast';
import {ConfirmDialogModule} from 'primeng/confirmdialog';
import {ConfirmationService, MessageService} from 'primeng/api';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ToolbarComponent,
    FileExplorerComponent,
    ToastModule,
    ConfirmDialogModule
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  providers: [MessageService, ConfirmationService]
})
export class AppComponent implements OnInit, AfterViewInit {

  @ViewChild('osmdContainer') osmdContainer!: ElementRef;
  @ViewChild('appContainer') appContainer!: ElementRef;
  @ViewChild(FileExplorerComponent) fileExplorer!: FileExplorerComponent;

  private currentScoreId: string = '';

  zoomLevel: number = 1.5;
  showPositions: boolean = true;
  currentKey: string = 'C';
  fileName: string = '';
  isOSMDReady: boolean = false;
  isLoading: boolean = false;
  errorMessage: string = '';
  sidebarVisible: boolean = true; // Controle da sidebar
  instruments: { id: number, name: string, visible: boolean }[] = [];

  // Tela cheia
  isFullscreen: boolean = false;
  private prevSidebarVisible: boolean = true;

  // Lista de partituras selecionadas (para navegação)
  selectedScores: SelectedScore[] = [];
  private scoresSubscription?: any;


  constructor(
    private scoreLoader: ScoreLoaderService,
    private positionService: TrombonePositionService,
    private driveService: GoogleDriveService,
    private selectionService: ScoreSelectionService,
    private messageService: MessageService
  ) {}

  ngAfterViewInit(): void {
    setTimeout(() => this.initializeOSMD(), 100);
  }

  ngOnInit(): void {
    this.loadSettings();
    this.setupFullscreenListener();
    this.subscribeToScores();
  }

  private subscribeToScores(): void {
    this.scoresSubscription = this.selectionService.selectedScores$.subscribe(scores => {
      this.selectedScores = scores;
    });
  }

  ngOnDestroy(): void {
    if (this.scoresSubscription) {
      this.scoresSubscription.unsubscribe();
    }
  }

  private setupFullscreenListener(): void {
    document.addEventListener('fullscreenchange', () => {
      this.isFullscreen = !!document.fullscreenElement;
      if (!this.isFullscreen) {
        this.sidebarVisible = this.prevSidebarVisible;
      }
    });
    // Compatibilidade com outros navegadores
    document.addEventListener('webkitfullscreenchange', () => {
      this.isFullscreen = !!(document as any).webkitFullscreenElement;
      if (!this.isFullscreen) {
        this.sidebarVisible = this.prevSidebarVisible;
      }
    });
  }

  protected async initializeOSMD(): Promise<void> {
    if (!this.osmdContainer?.nativeElement) {
      console.error('Container do OSMD não encontrado');
      this.errorMessage = 'Erro: Container da partitura não encontrado';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const container = this.osmdContainer.nativeElement;
      console.log('Inicializando OSMD no container:', container);

      await this.scoreLoader.initializeOSMD(container, {
        backend: 'svg',
        autoResize: true,
        drawingParameters: 'compacttight',
        drawTitle: true
      });

      this.isOSMDReady = true;

      // Carregar exemplo após inicialização
      setTimeout(() => {
        this.loadExampleScore();
      }, 500);

    } catch (error) {
      console.error('Erro ao inicializar OSMD:', error);
      this.errorMessage = `Falha ao inicializar visualizador de partituras: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
      this.isOSMDReady = false;
    } finally {
      this.isLoading = false;
    }
  }

  async loadScoreFromGoogleDrive(fileId: string): Promise<void> {
    if (!this.isOSMDReady) return;

    console.log('[App] Carregando partitura do Google Drive:', fileId);
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const fileName = await this.driveService.getFolderName(fileId); // Nome do arquivo
      const xmlContent = await this.driveService.getFileContent(fileId);
      if (xmlContent) {
        await this.scoreLoader.loadXML(xmlContent, fileName);
        this.fileName = fileName;
        this.currentScoreId = fileId;

        // Apenas detecta a tonalidade, não salva na lista de seleção ainda
        const detectedKey = this.scoreLoader.detectKeyFromXML(xmlContent);
        this.currentKey = detectedKey;

        this.updateInstrumentsList();
        this.applyZoom();
        console.log('[App] Partitura do Drive carregada com sucesso');
      } else {
        throw new Error('Não foi possível obter o conteúdo do arquivo');
      }
    } catch (error) {
      console.error('[App] Erro ao carregar do Google Drive:', error);
      this.errorMessage = `Erro ao carregar arquivo do Google Drive: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
    } finally {
      this.isLoading = false;
    }
  }

  zoomIn(): void {
    this.zoomLevel = Math.min(this.zoomLevel + 0.1, 3.0);
    this.applyZoom();
  }

  zoomOut(): void {
    this.zoomLevel = Math.max(this.zoomLevel - 0.1, 0.5);
    this.applyZoom();
  }

  private applyZoom(): void {
    if (this.isOSMDReady) {
      this.scoreLoader.setZoom(this.zoomLevel);
    }
  }

  // Atualizar togglePositions
  async togglePositions(): Promise<void> {
    if (!this.isOSMDReady) return;

    this.showPositions = !this.showPositions;

    if (this.showPositions) {
      console.log('Adicionando posições...');
      this.isLoading = true;
      try {
        // Adicionar posições via MusicXML
        await this.scoreLoader.addPositionsToCurrentScore();

        // Se houver instrumentos ocultos, reaplicar
        this.reapplyInstrumentVisibility();
        this.applyZoom();
      } finally {
        this.isLoading = false;
      }
    } else {
      console.log('Removendo posições...');
      this.isLoading = true;
      try {
        // Obter XML atual e remover posições via MusicXML (para limpar o lyric)
        const osmd = (this.scoreLoader as any).osmd;
        const currentXml = this.scoreLoader.getCurrentXML() || (this.scoreLoader as any).originalXml;
        if (currentXml) {
          const cleanedXml = this.scoreLoader.removePositionsFromXML(currentXml);
          await osmd.load(cleanedXml);
          this.reapplyInstrumentVisibility();
          this.applyZoom();
        }
        this.positionService.removePositions(); // Limpa estado interno e SVG se houver
      } finally {
        this.isLoading = false;
      }
    }
  }

/*
  async transposeToKey(key: string): Promise<void> {
    if (!this.isOSMDReady) {
      console.warn('OSMD não está pronto para transposição');
      return;
    }

    console.log(`[App] Transpondo de ${this.currentKey} para ${key}`);

    const semitones = this.positionService.getSemitonesFromKey(this.currentKey, key);
    console.log(`[App] Semitons calculados: ${semitones}`);

    if (semitones !== 0) {
      this.isLoading = true;

      try {
        // 1. Apagar as marcações de posições atuais
        this.positionService.removePositions();
        this.showPositions = false; // Desativar flag visual

        // 2. Transpor a partitura (usando o método assíncrono agora)
        await this.scoreLoader.transpose(semitones);

        // 3. Atualizar a tonalidade atual
        this.currentKey = key;

        // 4. Reaplicar a visibilidade dos instrumentos (força render no final)
        this.reapplyInstrumentVisibility();

        // 5. Aplicar zoom e renderizar final
        this.applyZoom();

        // 6. Não salvar automaticamente aqui; o usuário deve clicar em "Salva Seleção" para persistir

        console.log('[App] Transposição concluída e posições removidas.');

      } catch (error) {
        console.error('[App] Erro na transposição:', error);
        this.errorMessage = 'Erro ao transpor partitura. Tente recarregar.';
      } finally {
        this.isLoading = false;
      }
    }
  }
*/

  // No componente que gerencia o OSMD
  onTranspose(targetKey: string) {
    // 1. Obtém a inteligência da transposição (semitones + armadura)
    const info = this.positionService.getTransposeInfo('C', targetKey);

    // 2. Reaplica as posições injetando a nova armadura no XML
    this.positionService.addPositionsToScore(this.osmd, this.originalXml, info);
  }


// Atualizar também a inicialização para garantir que o exemplo tenha tonalidade correta
  async loadExampleScore(): Promise<void> {
    if (!this.isOSMDReady) return;

    this.isLoading = true;
    try {
      const result = await this.scoreLoader.loadExampleScore();
      this.fileName = 'Exemplo Trombone';

      // Atualizar a tonalidade com a detectada no XML
      if (result && (result as any).key) {
        this.currentKey = (result as any).key;
      }

      this.applyZoom();
      this.updateInstrumentsList();

      // Se não estiver em C (e não for a tonalidade detectada), transpor o exemplo
      // Nota: Se detectada for C e currentKey for C, não transpõe.
      // Se detectada for G e currentKey for C, transpor para C (preferência do usuário).
      // Mas o requisito diz: "Ao selecionar um novo arquivo xml, a tonalidade que esta no arquivo deve ser selecionada no select da toolbar."
      // Então ignoramos a preferência anterior e usamos a do arquivo.

      if (this.showPositions) {
        setTimeout(async () => {
          await this.scoreLoader.addPositionsToCurrentScore();
          this.reapplyInstrumentVisibility();
          this.applyZoom();
        }, 800);
      }

    } catch (error) {
      console.error('Erro ao carregar exemplo:', error);
      this.errorMessage = `Erro ao carregar partitura: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
    } finally {
      this.isLoading = false;
    }
  }

// Atualizar loadScoreFromFile
  async loadScoreFromFile(file: File): Promise<void> {
    if (!this.isOSMDReady) {
      this.errorMessage = 'Aguarde a inicialização do visualizador';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const result = await this.scoreLoader.loadFile(file);
      this.fileName = file.name;
      this.currentScoreId = `local-${file.name}-${file.size}-${file.lastModified}`;

      // Apenas detecta a tonalidade, não salva na lista de seleção ainda
      if (result && (result as any).key) {
        this.currentKey = (result as any).key;
      }

      this.applyZoom();
      this.updateInstrumentsList();

      if (this.showPositions) {
        setTimeout(async () => {
          await this.scoreLoader.addPositionsToCurrentScore();
          this.reapplyInstrumentVisibility();
          this.applyZoom();
        }, 800);
      }

    } catch (error) {
      console.error('Erro ao carregar partitura:', error);
      this.errorMessage = `Erro: ${error instanceof Error ? error.message : 'Falha ao carregar arquivo'}`;
    } finally {
      this.isLoading = false;
    }
  }

  toggleFullscreen(): void {
    if (!this.isFullscreen) {
      this.prevSidebarVisible = this.sidebarVisible;
      this.enterFullscreen();
    } else {
      this.exitFullscreen();
    }
  }

  private enterFullscreen(): void {
    const element = this.appContainer.nativeElement;
    if (element.requestFullscreen) {
      element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen();
    } else if (element.msRequestFullscreen) {
      element.msRequestFullscreen();
    }
    this.isFullscreen = true;
    this.sidebarVisible = false;
  }

  exitFullscreen(): void {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    } else if ((document as any).msExitFullscreen) {
      (document as any).msExitFullscreen();
    }
    this.isFullscreen = false;
    this.sidebarVisible = this.prevSidebarVisible;
  }

  async loadSelectedScore(score: SelectedScore): Promise<void> {
    if (!this.isOSMDReady) return;

    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.currentScoreId = score.id;
      this.fileName = score.name;
      this.zoomLevel = score.settings.zoomLevel;
      this.currentKey = score.settings.currentKey;
      this.showPositions = score.settings.showPositions;

      await this.scoreLoader.loadXML(score.xmlContent, score.name);

      this.updateInstrumentsList();

      // Aplicar visibilidade dos instrumentos salva
      if (score.settings.instrumentVisibility) {
        this.instruments.forEach(inst => {
          if (score.settings.instrumentVisibility[inst.id] !== undefined) {
            inst.visible = score.settings.instrumentVisibility[inst.id];
          }
        });
        this.reapplyInstrumentVisibility();
      }

      this.applyZoom();

      if (this.showPositions) {
        setTimeout(async () => {
          await this.scoreLoader.addPositionsToCurrentScore();
          this.reapplyInstrumentVisibility();
          this.applyZoom();
        }, 500);
      }
    } catch (error) {
      console.error('Erro ao carregar partitura selecionada:', error);
      this.errorMessage = `Erro ao carregar partitura: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
    } finally {
      this.isLoading = false;
    }
  }

  async onRemoveScores(ids: string[]): Promise<void> {
    await this.selectionService.removeScores(ids);
    if (ids.includes(this.currentScoreId)) {
      this.scoreLoader.clear();
      this.currentScoreId = '';
      this.fileName = '';
    }
  }

  async onResetScore(id: string): Promise<void> {
    await this.selectionService.resetScore(id);
    if (this.currentScoreId === id) {
      const scores = await new Promise<SelectedScore[]>(resolve => {
        const sub = this.selectionService.selectedScores$.subscribe(s => {
          sub.unsubscribe();
          resolve(s);
        });
      });
      const resetScore = scores.find(s => s.id === id);
      if (resetScore) {
        this.loadSelectedScore(resetScore);
      }
    }
  }

  onOrderChanged(scores: SelectedScore[]): void {
    this.selectionService.updateOrder(scores);
  }

  async loadNextScore(): Promise<void> {
    if (this.selectedScores.length <= 1) return;

    const currentIndex = this.selectedScores.findIndex(s => s.id === this.currentScoreId);
    let nextIndex = currentIndex + 1;

    if (nextIndex >= this.selectedScores.length) {
      nextIndex = 0; // Volta para o início
    }

    await this.loadSelectedScore(this.selectedScores[nextIndex]);
  }

  async loadPreviousScore(): Promise<void> {
    if (this.selectedScores.length <= 1) return;

    const currentIndex = this.selectedScores.findIndex(s => s.id === this.currentScoreId);
    let prevIndex = currentIndex - 1;

    if (prevIndex < 0) {
      prevIndex = this.selectedScores.length - 1; // Vai para o fim
    }

    await this.loadSelectedScore(this.selectedScores[prevIndex]);
  }

  toggleSidebar(): void {
    this.sidebarVisible = !this.sidebarVisible;
  }

  private reapplyInstrumentVisibility(): void {
    console.log('[App] Reaplicando visibilidade dos instrumentos...');
    if (this.instruments && this.instruments.length > 0) {
      this.instruments.forEach((inst, index) => {
        // Não renderizar a cada loop, apenas no final
        const isLast = index === this.instruments.length - 1;
        this.scoreLoader.setInstrumentVisibility(inst.id, inst.visible, isLast);
      });
    }
  }

  private loadSettings(): void {
    const savedSettings = localStorage.getItem('trombone-viewer-settings');
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      this.zoomLevel = settings.zoomLevel || 1.5;
      this.showPositions = settings.showPositions !== false;
      this.currentKey = settings.currentKey || 'C';
      this.sidebarVisible = settings.sidebarVisible !== false;
    }
  }

  async saveSettings(): Promise<void> {
    const instrumentVisibility: { [key: string]: boolean } = {};
    this.instruments.forEach(inst => {
      instrumentVisibility[inst.id] = inst.visible;
    });

    const settings = {
      zoomLevel: this.zoomLevel,
      showPositions: this.showPositions,
      currentKey: this.currentKey,
      sidebarVisible: this.sidebarVisible,
      instrumentVisibility: instrumentVisibility
    };
    localStorage.setItem('trombone-viewer-settings', JSON.stringify(settings));

    // Salvar ou atualizar no IndexedDB se houver uma partitura ativa
    if (this.currentScoreId) {
      console.log('[App] Tentando salvar seleção para ID:', this.currentScoreId);
      try {
        const xml = await this.scoreLoader.getCurrentXML();
        const originalXml = (this.scoreLoader as any).originalXml || xml;

        if (!xml) {
          console.warn('[App] XML atual está vazio, usando originalXml se disponível');
        }

        // Verificar se já existe na lista de seleção
        const { firstValueFrom } = await import('rxjs');
        const scores = await firstValueFrom(this.selectionService.selectedScores$);

        const exists = scores.some(s => s.id === this.currentScoreId);
        console.log('[App] Partitura já existe na lista?', exists);

        if (exists) {
          console.log('[App] Chamando updateScoreSettings');
          await this.selectionService.updateScoreSettings(this.currentScoreId, {
            zoomLevel: this.zoomLevel,
            currentKey: this.currentKey,
            showPositions: this.showPositions,
            instrumentVisibility: instrumentVisibility
          }, xml);
        } else {
          console.log('[App] Chamando addScore');
          await this.selectionService.addScore({
            id: this.currentScoreId,
            name: this.fileName,
            xmlContent: xml || originalXml,
            originalXmlContent: originalXml,
            settings: {
              zoomLevel: this.zoomLevel,
              currentKey: this.currentKey,
              showPositions: this.showPositions,
              instrumentVisibility: instrumentVisibility
            }
          });
        }
        this.messageService.add({ severity: 'success', summary: 'Sucesso', detail: 'Seleção salva com sucesso!' });
        if (this.fileExplorer) {
          this.fileExplorer.activePanel = 'selection';
        }
      } catch (error) {
        console.error('[App] Erro detalhado ao salvar na lista de seleção:', error);
        this.messageService.add({ severity: 'error', summary: 'Erro', detail: 'Erro ao salvar seleção.' });
      }
    } else {
      console.warn('[App] Nenhuma partitura aberta (currentScoreId vazio)');
      this.messageService.add({ severity: 'warn', summary: 'Atenção', detail: 'Nenhuma partitura aberta para salvar.' });
    }
  }

  updateInstrumentsList(): void {
    this.instruments = this.scoreLoader.getInstruments();
    console.log('[App] Lista de instrumentos atualizada:', this.instruments);
  }

  onInstrumentVisibilityChange(event: { id: number, visible: boolean }): void {
    console.log(`[App] Alterando visibilidade do instrumento ${event.id} para ${event.visible}`);
    this.scoreLoader.setInstrumentVisibility(event.id, event.visible);
    this.updateInstrumentsList(); // Atualizar estado local para refletir na UI

    // Recriar posições se necessário, pois a renderização mudou
    if (this.showPositions) {
      setTimeout(() => {
        this.positionService.addPositionsToScore();
      }, 300);
    }
  }
}
