import {AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {ToolbarComponent} from '../../components/toolbar/toolbar.component';
import {FileExplorerComponent} from '../../components/file-explorer/file-explorer.component';
import {ScoreLoaderService} from '../../services/score-loader.service';
import {TrombonePositionService} from '../../services/trombone-position.service';
import {GoogleDriveService} from '../../services/google-drive.service';
import {ScoreSelectionService, SelectedScore} from '../../services/score-selection.service';

import {ToastModule} from 'primeng/toast';
import {ConfirmDialogModule} from 'primeng/confirmdialog';
import {ConfirmationService, MessageService} from 'primeng/api';

@Component({
  selector: 'app-music-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ToolbarComponent,
    FileExplorerComponent,
    ToastModule,
    ConfirmDialogModule
  ],
  templateUrl: './music-page.component.html',
  styleUrls: ['./music-page.component.scss'],
  providers: [MessageService, ConfirmationService]
})
export class MusicPageComponent implements OnInit, AfterViewInit, OnDestroy {

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
  private prevSidebarVisible: boolean = true;
  private controlsTimer: any;
  isFullscreen: boolean = false;
  showFloatingControls: boolean = true;

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
    this.resetControlsTimer();
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

    console.log('[MusicPage] Carregando partitura do Google Drive:', fileId);
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
        const detectedKey = (this.scoreLoader as any).detectKeyFromXML(xmlContent);
        this.currentKey = detectedKey;

        this.updateInstrumentsList();
        this.applyZoom();
        console.log('[MusicPage] Partitura do Drive carregada com sucesso');
      } else {
        throw new Error('Não foi possível obter o conteúdo do arquivo');
      }
    } catch (error) {
      console.error('[MusicPage] Erro ao carregar do Google Drive:', error);
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

  // Método de transposição corrigido
  async transposeToKey(targetKey: string): Promise<void> {
    if (!this.isOSMDReady) return;

    this.isLoading = true;
    try {
      // 1. Obtém a inteligência da transposição (semitones + armadura)
      const info = this.positionService.getTransposeInfo('C', targetKey);

      // 2. Acessa as propriedades necessárias do ScoreLoader (osmd e xml original)
      // Como são privadas no serviço, usamos o cast 'any' para acessar
      const loader = this.scoreLoader as any;
      const osmd = loader.osmd;
      const originalXml = loader.originalXml; // Mantém o XML original como base

      if (osmd && originalXml) {
        // 3. Reaplica as posições injetando a nova armadura no XML
        const success = await this.positionService.addPositionsToScore(osmd, originalXml, info);

        if (success) {
          this.currentKey = targetKey;
          // Reaplicar configurações visuais após recarga do XML
          this.reapplyInstrumentVisibility();
          this.applyZoom();
        }
      } else {
        console.warn('OSMD ou XML Original não disponíveis para transposição');
      }
    } catch (error) {
      console.error('Erro na transposição:', error);
      this.errorMessage = 'Erro ao transpor partitura.';
    } finally {
      this.isLoading = false;
    }
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

    // ADICIONE ISTO: Garante que os controles apareçam assim que maximizar e sumam após 5s
    this.resetControlsTimer();
  }

  // O seu método resetControlsTimer já está correto, mas certifique-se que está assim:
  resetControlsTimer() {
    // Se não estiver em fullscreen, não faz nada (opcional, mas economiza processamento)
    if (!this.isFullscreen) return;

    this.showFloatingControls = true; // Mostra imediatamente

    if (this.controlsTimer) {
      clearTimeout(this.controlsTimer);
    }

    this.controlsTimer = setTimeout(() => {
      this.showFloatingControls = false; // Esconde após 5s
    }, 2000);
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

      // Hierarquia de configurações: Individual -> Global -> Padrão
      const globalSettings = await this.selectionService.getGlobalSettings();

      // Zoom
      this.zoomLevel = score.settings.zoomLevel ?? globalSettings.zoomLevel;

      // Tonalidade
      this.currentKey = score.settings.currentKey ||
        (globalSettings.currentKey !== 'Padrão da partitura' ? globalSettings.currentKey : '');

      // Mostrar Posições
      this.showPositions = score.settings.showPositions ?? globalSettings.showPositions;

      await this.scoreLoader.loadXML(score.xmlContent, score.name);

      this.updateInstrumentsList();

      // Aplicar visibilidade dos instrumentos
      if (score.settings.instrumentVisibility && Object.keys(score.settings.instrumentVisibility).length > 0) {
        // Individual
        this.instruments.forEach(inst => {
          if (score.settings.instrumentVisibility[inst.id] !== undefined) {
            inst.visible = score.settings.instrumentVisibility[inst.id];
          }
        });
      } else if (globalSettings.instruments) {
        // Global
        const globalInstrumentNames = globalSettings.instruments.split(';').map(n => n.trim().toLowerCase());
        const foundAny = this.instruments.some(inst => globalInstrumentNames.includes(inst.name.toLowerCase()));

        if (foundAny) {
          this.instruments.forEach(inst => {
            inst.visible = globalInstrumentNames.includes(inst.name.toLowerCase());
          });
        } else {
          // Se não encontrar nenhum da lista, traz todos selecionados
          this.instruments.forEach(inst => inst.visible = true);
        }
      } else {
        // Padrão (todos visíveis)
        this.instruments.forEach(inst => inst.visible = true);
      }

      this.reapplyInstrumentVisibility();
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
    console.log('[MusicPage] Reaplicando visibilidade dos instrumentos...');
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
      console.log('[MusicPage] Tentando salvar seleção para ID:', this.currentScoreId);
      try {
        const xml = await this.scoreLoader.getCurrentXML();
        const originalXml = (this.scoreLoader as any).originalXml || xml;

        if (!xml) {
          console.warn('[MusicPage] XML atual está vazio, usando originalXml se disponível');
        }

        // Verificar se já existe na lista de seleção
        const { firstValueFrom } = await import('rxjs');
        const scores = await firstValueFrom(this.selectionService.selectedScores$);

        const exists = scores.some(s => s.id === this.currentScoreId);
        console.log('[MusicPage] Partitura já existe na lista?', exists);

        // Ao salvar manualmente, as configurações passam a ser 'Individuais'
        if (exists) {
          console.log('[MusicPage] Chamando updateScoreSettings');
          await this.selectionService.updateScoreSettings(this.currentScoreId, {
            zoomLevel: this.zoomLevel,
            currentKey: this.currentKey,
            showPositions: this.showPositions,
            instrumentVisibility: instrumentVisibility
          }, xml);
        } else {
          console.log('[MusicPage] Chamando addScore');
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
        this.messageService.add({ severity: 'success', summary: 'Sucesso', detail: 'Configurações individuais salvas!' });
        if (this.fileExplorer) {
          this.fileExplorer.activePanel = 'selection';
        }
      } catch (error) {
        console.error('[MusicPage] Erro detalhado ao salvar na lista de seleção:', error);
        this.messageService.add({ severity: 'error', summary: 'Erro', detail: 'Erro ao salvar seleção.' });
      }
    } else {
      console.warn('[MusicPage] Nenhuma partitura aberta (currentScoreId vazio)');
      this.messageService.add({ severity: 'warn', summary: 'Atenção', detail: 'Nenhuma partitura aberta para salvar.' });
    }
  }

  updateInstrumentsList(): void {
    this.instruments = this.scoreLoader.getInstruments();
    console.log('[MusicPage] Lista de instrumentos atualizada:', this.instruments);
  }

  onInstrumentVisibilityChange(event: { id: number, visible: boolean }): void {
    console.log(`[MusicPage] Alterando visibilidade do instrumento ${event.id} para ${event.visible}`);
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
