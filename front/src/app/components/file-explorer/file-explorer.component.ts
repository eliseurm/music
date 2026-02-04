// components/file-explorer/file-explorer.component.ts
import {Component, Output, EventEmitter, Input, OnInit} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GoogleDriveService, GoogleDriveConfig } from '../../services/google-drive.service';
import { ScoreSelectionService, SelectedScore } from '../../services/score-selection.service';
import { Observable } from 'rxjs';
import { MessageService, ConfirmationService } from 'primeng/api';
import { ListboxModule } from 'primeng/listbox';
import { CheckboxModule } from 'primeng/checkbox'; // Pode remover se não for usar checkbox avulso em outro lugar

export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  extension: string;
  size?: number;
  modified?: Date;
}

@Component({
  selector: 'app-file-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule, ListboxModule, CheckboxModule],
  templateUrl: './file-explorer.component.html',
  styleUrls: ['./file-explorer.component.scss']
})
export class FileExplorerComponent implements OnInit {

  @Input() disabled: boolean = false;
  @Output() fileSelected = new EventEmitter<File>();
  @Output() driveFileSelected = new EventEmitter<string>();
  @Output() scoreSelected = new EventEmitter<SelectedScore>();
  @Output() removeScores = new EventEmitter<string[]>();
  @Output() resetScore = new EventEmitter<string>();
  @Output() orderChanged = new EventEmitter<SelectedScore[]>();

  files: FileItem[] = [];
  isLoading = false;
  showGoogleDrive = false;
  showConfig = false;
  currentFolderId: string = 'root';
  folderHistory: { id: string, name: string }[] = [];
  nextPageToken: string | undefined = undefined;
  searchQuery: string = '';

  // REFATORADO: Array para armazenar os arquivos selecionados diretamente pelo Listbox
  selectedDriveFiles: FileItem[] = [];

  isDownloading = false;
  isDriveConnected = false;

  // Accordion state
  activePanel: 'local' | 'drive' | 'selection' | null = 'selection';

  // Selection state
  selectedScores$: Observable<SelectedScore[]>;
  multiSelectMode = false;
  checkedScores: Set<string> = new Set();
  draggedItemIndex: number | null = null;

  driveConfig: GoogleDriveConfig = {
    userEmail: '',
    defaultFolderId: ''
  };

  constructor(
    private driveService: GoogleDriveService,
    private selectionService: ScoreSelectionService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {
    this.selectedScores$ = this.selectionService.selectedScores$;
  }

  ngOnInit(): void {
    // Carrega a configuração salva no cookie
    const config = this.driveService.getConfig();
    if (config) {
      this.driveConfig = { ...config };
    }

    // Define se o botão deve começar habilitado.
    // isAuthenticated retorna true se tiver token OU se tiver email salvo na config
    this.isDriveConnected = this.driveService.isAuthenticated();
  }

  // Ação do Botão Drive (Ícone do Drive)
  // Agora ele assume que já existe uma configuração, apenas carrega os arquivos.
// Ação do Botão Drive (Ícone do Drive)
// ... dentro de file-explorer.component.ts

  // Ação do Botão Drive
  async connectDrive(): Promise<void> {
    if (!this.driveConfig.userEmail) {
      this.toggleConfig();
      return;
    }

    this.isLoading = true;

    try {
      // Verifica no SERVIÇO se o token existe
      if (!this.driveService.hasValidAccessToken()) {
        console.log('[FileExplorer] Sem token em memória. Iniciando renovação...');
        await this.driveService.login(false, false);
      }

      this.isDriveConnected = true;
      await this.loadGoogleDriveFiles();

    } catch (error: any) {
      console.error('[FileExplorer] Erro ao conectar:', error);
      this.isDriveConnected = false;

      if (error?.type === 'popup_closed') {
        this.messageService.add({ severity: 'warn', summary: 'Cancelado', detail: 'Login cancelado.' });
      } else {
        this.messageService.add({ severity: 'error', summary: 'Erro', detail: 'Falha ao conectar ao Drive.' });
      }
    } finally {
      this.isLoading = false;
    }
  }

  // Ação do Botão Configuração -> "Fazer Login / Trocar Conta"
  async loginAndReload(): Promise<void> {
    try {
      this.isLoading = true;

      // Se já tinha alguém logado, faz logout local antes de trocar
      if (this.driveConfig.userEmail) {
        this.driveService.logout();
      }

      // Login Interativo (true): Abre popup do Google para escolher conta
      await this.driveService.login(true);

      // Atualiza configuração local após sucesso
      const config = this.driveService.getConfig();
      if (config) {
        this.driveConfig = { ...config };
      }

      // SUCESSO: Habilita o botão do Drive e fecha o modal
      this.isDriveConnected = true;
      this.showConfig = false;

      // Já carrega os arquivos imediatamente para feedback visual
      await this.loadGoogleDriveFiles();

    } catch (error: any) {
      console.error('Login falhou', error);
      if (error?.type !== 'popup_closed') {
        this.messageService.add({ severity: 'error', summary: 'Erro', detail: 'Falha na autenticação.' });
      }
      // Se falhou, mantemos desconectado (ou o estado anterior)
      // Se não tem e-mail, botão do drive fica desabilitado
      if (!this.driveConfig.userEmail) {
        this.isDriveConnected = false;
      }
    } finally {
      this.isLoading = false;
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      if (this.isValidFile(file)) {
        this.fileSelected.emit(file);
      }
    }
  }

  async loadGoogleDriveFiles(folderId: string = 'root', pageToken?: string, isRefresh: boolean = false): Promise<void> {
    console.log(`[FileExplorer] Carregando arquivos: ${folderId}`);

    // Se não houver email configurado, nem tenta carregar
    const config = this.driveService.getConfig();
    if (!config || !config.userEmail) {
      this.isDriveConnected = false;
      return;
    }
    this.driveConfig = { ...config };

    // REFATORADO: Usa o array do ngModel
    const selectedFilesBefore = [...this.selectedDriveFiles];

    if (isRefresh) {
      this.selectedDriveFiles = [];
      this.nextPageToken = undefined;
    }

    if (!this.showGoogleDrive) {
      this.showGoogleDrive = true;
    }

    this.isLoading = true;
    try {
      if (folderId === 'root' && this.driveConfig.defaultFolderId && this.currentFolderId === 'root' && !pageToken && !isRefresh && !this.searchQuery) {
        folderId = this.driveConfig.defaultFolderId;
      }

      const result = await this.driveService.listFiles(folderId, pageToken, this.searchQuery);

      this.isDriveConnected = true; // Se listFiles funcionou, está conectado

      if (pageToken) {
        this.files = [...this.files, ...result.files];
      } else {
        this.files = result.files;

        // Recoloca arquivos selecionados na lista visual se tiverem sumido (ex: durante busca)
        if (this.searchQuery && selectedFilesBefore.length > 0) {
          selectedFilesBefore.forEach(selectedFile => {
            if (!this.files.some(f => f.id === selectedFile.id)) {
              this.files.unshift(selectedFile);
            }
          });
        }
      }

      this.nextPageToken = result.nextPageToken;
      this.currentFolderId = folderId;

      const updatedConfig = this.driveService.getConfig();
      if (updatedConfig) {
        this.driveConfig = { ...updatedConfig };
      }

      if (!this.searchQuery && !pageToken) {
        if (folderId === 'root') {
          this.folderHistory = [{ id: 'root', name: 'Meu Drive' }];
        } else if (!this.folderHistory.find(f => f.id === folderId)) {
          const folderName = await this.driveService.getFolderName(folderId);
          this.folderHistory.push({ id: folderId, name: folderName });
        } else {
          const index = this.folderHistory.findIndex(f => f.id === folderId);
          this.folderHistory = this.folderHistory.slice(0, index + 1);
        }
      }
    } catch (error) {
      console.error('Erro Drive:', error);
      this.files = [];
      this.messageService.add({ severity: 'error', summary: 'Google Drive', detail: 'Erro ao carregar arquivos.' });
    } finally {
      this.isLoading = false;
    }
  }

  onSearchDrive(): void {
    this.nextPageToken = undefined;
    this.loadGoogleDriveFiles(this.currentFolderId);
  }

  loadMoreDrive(): void {
    if (this.nextPageToken) {
      this.loadGoogleDriveFiles(this.currentFolderId, this.nextPageToken);
    }
  }

  // Métodos toggleDriveFileCheck REMOVIDOS - o p-listbox gerencia isso nativamente agora

  async downloadSelectedDriveFiles(): Promise<void> {
    // REFATORADO: Usa this.selectedDriveFiles
    if (this.selectedDriveFiles.length === 0) return;

    this.isDownloading = true;
    let successCount = 0;

    try {
      for (const file of this.selectedDriveFiles) {
        try {
          console.log(`[FileExplorer] Baixando: ${file.name}`);
          const xmlContent = await this.driveService.getFileContent(file.id);

          if (xmlContent) {
            const score: Omit<SelectedScore, 'order'> = {
              id: `drive-${file.id}`,
              name: file.name,
              xmlContent: xmlContent,
              originalXmlContent: xmlContent,
              settings: {
                zoomLevel: 1.0,
                currentKey: '',
                showPositions: false,
                instrumentVisibility: {}
              }
            };

            await this.selectionService.addScore(score);
            successCount++;
          }
        } catch (err) {
          console.error(`Erro ao baixar ${file.id}:`, err);
        }
      }

      this.messageService.add({
        severity: 'success',
        summary: 'Download Concluído',
        detail: `${successCount} arquivo(s) adicionado(s).`
      });

      this.selectedDriveFiles = []; // Limpa seleção após baixar
      this.activePanel = 'selection';

    } catch (error) {
      this.messageService.add({ severity: 'error', summary: 'Erro', detail: 'Erro ao baixar arquivos.' });
    } finally {
      this.isDownloading = false;
    }
  }

  async navigateToFolder(folder: { id: string, name: string }): Promise<void> {
    await this.loadGoogleDriveFiles(folder.id);
  }

  async onFileItemClick(event: any): Promise<void> {
    // Nota: O clique nativo do p-listbox seleciona o item.
    // Se for pasta, queremos navegar e não selecionar.
    // O template interceptará cliques em pastas se necessário, ou verificamos aqui.
    // Mas o p-listbox com checkbox="true" foca em seleção.
    // Para navegação em pastas, é melhor usar um botão específico no template ou verificar o item.

    // Como estamos usando selection mode, o clique na linha seleciona.
    // Se quisermos navegar ao clicar na pasta, precisamos tratar isso.
    // No template HTML, adicionaremos um handler específico para o clique na pasta.
  }

  // Método auxiliar para navegação ao clicar no ícone/nome da pasta (será chamado do template)
  handleItemClick(event: Event, file: FileItem): void {
    if (file.type === 'folder') {
      event.stopPropagation(); // Impede seleção do checkbox
      this.loadGoogleDriveFiles(file.id);
    } else {
      // Se for arquivo, deixa o comportamento padrão do listbox (selecionar)
      // OU se quiser abrir visualização direta:
      // this.selectDriveFile(file.id);
    }
  }

  setDefaultFolder(): void {
    if (this.currentFolderId) {
      const folderName = this.folderHistory[this.folderHistory.length - 1].name;
      this.driveConfig.defaultFolderId = this.currentFolderId;
      this.driveConfig.defaultFolderName = folderName;
      this.driveService.saveConfig(this.driveConfig);
      this.messageService.add({ severity: 'success', summary: 'Pasta padrão', detail: `Pasta definida.` });
    }
  }

  selectDriveFile(fileId: string): void {
    this.driveFileSelected.emit(fileId);
  }

  toggleConfig(): void {
    this.showConfig = !this.showConfig;
    if (this.showConfig) {
      const config = this.driveService.getConfig();
      if (config) {
        this.driveConfig = { ...config };
      }
    }
  }

  saveDriveConfig(): void {
    this.driveService.saveConfig(this.driveConfig);
    this.showConfig = false;
    // Se mudou algo na config (como e-mail), garante que o componente saiba
    const config = this.driveService.getConfig();
    if (config) {
      this.driveConfig = { ...config };
    }
    this.loadGoogleDriveFiles();
  }

  dragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  dragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  drop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      if (this.isValidFile(file)) {
        this.fileSelected.emit(file);
      }
    }
  }

  private isValidFile(file: File): boolean {
    const validExtensions = ['.musicxml', '.xml', '.mscz'];
    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    return validExtensions.includes(extension);
  }

  getFileIcon(file: FileItem): string {
    if (file.type === 'folder') {
      return 'fas fa-folder';
    }
    switch (file.extension.toLowerCase()) {
      case '.mscz': return 'fas fa-file-audio';
      case '.musicxml':
      case '.xml': return 'fas fa-file-music';
      default: return 'fas fa-file';
    }
  }

  togglePanel(panel: 'local' | 'drive' | 'selection'): void {
    if (this.activePanel === panel) {
      this.activePanel = null;
    } else {
      this.activePanel = panel;

      // REMOVIDO: O trecho abaixo causava o carregamento automático.
      // Agora o carregamento só ocorrerá se o usuário clicar explicitamente no botão do Drive.

      /* if (panel === 'drive' && this.isDriveConnected && this.files.length === 0 && !this.isLoading) {
        this.loadGoogleDriveFiles(this.currentFolderId);
      }
      */
    }
  }

  onScoreClick(score: SelectedScore): void {
    if (this.multiSelectMode) {
      this.toggleScoreCheck(score.id);
    } else {
      this.scoreSelected.emit(score);
    }
  }

  toggleScoreCheck(id: string): void {
    if (this.checkedScores.has(id)) {
      this.checkedScores.delete(id);
    } else {
      this.checkedScores.add(id);
    }
    if (this.checkedScores.size === 0) {
      this.multiSelectMode = false;
    }
  }

  enterMultiSelect(): void {
    this.multiSelectMode = true;
  }

  exitMultiSelect(): void {
    this.multiSelectMode = false;
    this.checkedScores.clear();
  }

  deleteSelected(): void {
    if (this.checkedScores.size > 0) {
      const count = this.checkedScores.size;
      this.confirmationService.confirm({
        header: 'Confirmar exclusão',
        message: `Remover ${count} partituras?`,
        icon: 'pi pi-exclamation-triangle',
        accept: () => {
          this.removeScores.emit(Array.from(this.checkedScores));
          this.exitMultiSelect();
          this.messageService.add({ severity: 'success', summary: 'Sucesso', detail: 'Partituras removidas.' });
        }
      });
    }
  }

  onResetScore(event: Event, id: string): void {
    event.stopPropagation();
    this.confirmationService.confirm({
      header: 'Resetar partitura',
      message: 'Restaurar configurações originais?',
      icon: 'pi pi-refresh',
      accept: () => {
        this.resetScore.emit(id);
        this.messageService.add({ severity: 'success', summary: 'Resetado', detail: 'Configurações restauradas.' });
      }
    });
  }

  onDragStart(event: DragEvent, index: number): void {
    if (this.multiSelectMode) { event.preventDefault(); return; }
    this.draggedItemIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  onDragOverListItem(event: DragEvent): void {
    event.preventDefault();
  }

  onDragEnd(): void {
    this.draggedItemIndex = null;
  }

  onDropListItem(event: DragEvent, targetIndex: number, scores: SelectedScore[]): void {
    event.preventDefault();
    let fromIndex = this.draggedItemIndex;
    if (fromIndex === null && event.dataTransfer) {
      const data = event.dataTransfer.getData('text/plain');
      const parsed = parseInt(data, 10);
      if (!isNaN(parsed)) fromIndex = parsed;
    }
    if (fromIndex === null || fromIndex === targetIndex) {
      this.draggedItemIndex = null;
      return;
    }
    const newScores = [...scores];
    const draggedItem = newScores.splice(fromIndex, 1)[0];
    newScores.splice(targetIndex, 0, draggedItem);
    this.orderChanged.emit(newScores);
    this.draggedItemIndex = null;
  }
}
