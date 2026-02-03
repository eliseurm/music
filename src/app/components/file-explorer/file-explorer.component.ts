// components/file-explorer/file-explorer.component.ts
import {Component, Output, EventEmitter, Input, OnInit} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GoogleDriveService, GoogleDriveConfig } from '../../services/google-drive.service';
import { ScoreSelectionService, SelectedScore } from '../../services/score-selection.service';
import { Observable } from 'rxjs';
import { MessageService, ConfirmationService } from 'primeng/api';

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
  imports: [CommonModule, FormsModule],
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

  // Accordion state
  activePanel: 'files' | 'selection' | null = 'selection';

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
    const config = this.driveService.getConfig();
    if (config) {
      this.driveConfig = { ...config };
    }
  }

  onFileSelected(event: Event): void {
    console.log('[FileExplorer] Arquivo selecionado via input');
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      console.log(`[FileExplorer] Arquivo: ${file.name}, Tamanho: ${file.size}, Tipo: ${file.type}`);
      if (this.isValidFile(file)) {
        this.fileSelected.emit(file);
      } else {
        console.warn(`[FileExplorer] Extensão de arquivo inválida: ${file.name}`);
      }
    }
  }

  async loadGoogleDriveFiles(folderId: string = 'root'): Promise<void> {
    console.log(`[FileExplorer] Carregando arquivos da pasta: ${folderId}`);

    if (!this.showGoogleDrive) {
      this.showGoogleDrive = true;
    }

    this.isLoading = true;
    try {
      // Se for a primeira carga e houver pasta padrão, usa ela
      if (folderId === 'root' && this.driveConfig.defaultFolderId && this.currentFolderId === 'root') {
        folderId = this.driveConfig.defaultFolderId;
      }

      this.files = await this.driveService.listFiles(folderId);
      this.currentFolderId = folderId;

      // Se logou com sucesso, atualiza o config local (para pegar o email obtido)
      const updatedConfig = this.driveService.getConfig();
      if (updatedConfig) {
        this.driveConfig = { ...updatedConfig };
      }

      // Atualizar histórico de navegação
      if (folderId === 'root') {
        this.folderHistory = [{ id: 'root', name: 'Meu Drive' }];
      } else if (!this.folderHistory.find(f => f.id === folderId)) {
        const folderName = await this.driveService.getFolderName(folderId);
        this.folderHistory.push({ id: folderId, name: folderName });
      } else {
        // Se já existe, remove os itens à frente (navegação de volta)
        const index = this.folderHistory.findIndex(f => f.id === folderId);
        this.folderHistory = this.folderHistory.slice(0, index + 1);
      }

      console.log(`[FileExplorer] ${this.files.length} arquivos encontrados no Drive`);
    } catch (error) {
      console.error('Erro ao carregar arquivos do Google Drive:', error);
      this.files = [];
      this.messageService.add({ severity: 'error', summary: 'Google Drive', detail: 'Não foi possível carregar os arquivos. Verifique sua conexão e tente novamente.' });
    } finally {
      this.isLoading = false;
    }
  }

  async navigateToFolder(folder: { id: string, name: string }): Promise<void> {
    await this.loadGoogleDriveFiles(folder.id);
  }

  async onFileItemClick(file: FileItem): Promise<void> {
    if (file.type === 'folder') {
      await this.loadGoogleDriveFiles(file.id);
    } else {
      this.selectDriveFile(file.id);
    }
  }

  setDefaultFolder(): void {
    if (this.currentFolderId) {
      const folderName = this.folderHistory[this.folderHistory.length - 1].name;
      this.driveConfig.defaultFolderId = this.currentFolderId;
      this.driveConfig.defaultFolderName = folderName;
      this.driveService.saveConfig(this.driveConfig);
      this.messageService.add({ severity: 'success', summary: 'Pasta padrão', detail: `Pasta "${folderName}" definida como padrão.` });
    }
  }

  selectDriveFile(fileId: string): void {
    console.log(`[FileExplorer] Arquivo do Drive selecionado: ${fileId}`);
    this.driveFileSelected.emit(fileId);
  }

  async loginAndReload(): Promise<void> {
    try {
      // 1. Faz logout local para limpar estado da conta anterior
      if (this.driveConfig.userEmail) {
        this.driveService.logout();
      }

      // 2. IMPORTANTE: Passa 'true' para forçar a tela de seleção de conta
      await this.driveService.login(true);

      const config = this.driveService.getConfig();
      if (config) {
        this.driveConfig = { ...config };
      }
      this.showConfig = false;
      await this.loadGoogleDriveFiles();
    } catch (error: any) {
      console.error('Erro ao fazer login:', error);
      // Ignora erro se usuário fechou o popup
      if (error?.type !== 'popup_closed') {
        this.messageService.add({ severity: 'error', summary: 'Autenticação', detail: 'Não foi possível autenticar. Tente desativar bloqueadores de anúncio.' });
      }
    }
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
    console.log('[FileExplorer] Configuração do Google Drive salva');
    this.loadGoogleDriveFiles(); // Tenta carregar após salvar
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
    console.log('[FileExplorer] Arquivo solto na zona de drop');
    event.preventDefault();
    event.stopPropagation();

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      console.log(`[FileExplorer] Arquivo solto: ${file.name}`);
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
      case '.mscz':
        return 'fas fa-file-audio';
      case '.musicxml':
      case '.xml':
        return 'fas fa-file-music';
      default:
        return 'fas fa-file';
    }
  }

  // Accordion methods
  togglePanel(panel: 'files' | 'selection'): void {
    if (this.activePanel === panel) {
      this.activePanel = null;
    } else {
      this.activePanel = panel;
    }
  }

  // Selection methods
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
        message: `Deseja remover ${count} partituras?`,
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Remover',
        rejectLabel: 'Cancelar',
        acceptButtonStyleClass: 'p-button-danger',
        accept: () => {
          this.removeScores.emit(Array.from(this.checkedScores));
          this.exitMultiSelect();
          this.messageService.add({ severity: 'success', summary: 'Excluído', detail: `${count} partitura(s) removida(s).` });
        }
      });
    }
  }

  onResetScore(event: Event, id: string): void {
    event.stopPropagation();
    this.confirmationService.confirm({
      header: 'Resetar partitura',
      message: 'Deseja resetar as configurações desta partitura para o original?',
      icon: 'pi pi-refresh',
      acceptLabel: 'Resetar',
      rejectLabel: 'Cancelar',
      accept: () => {
        this.resetScore.emit(id);
        this.messageService.add({ severity: 'success', summary: 'Resetado', detail: 'Configurações restauradas.' });
      }
    });
  }

  // Drag and Drop reordering
  onDragStart(event: DragEvent, index: number): void {
    if (this.multiSelectMode) {
      // Não permitir arrastar no modo de seleção múltipla
      event.preventDefault();
      return;
    }
    this.draggedItemIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Alguns navegadores (Firefox) exigem setData para habilitar drop
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  onDragOverListItem(event: DragEvent): void {
    event.preventDefault();
  }

  // Opcional: limpar estado se usuário cancelar o drag
  // (alguns navegadores disparam dragend)
  // Não quebra compatibilidade se não for chamado
  onDragEnd(): void {
    this.draggedItemIndex = null;
  }

  onDropListItem(event: DragEvent, targetIndex: number, scores: SelectedScore[]): void {
    event.preventDefault();

    // Recupera índice de origem
    let fromIndex = this.draggedItemIndex;
    if (fromIndex === null && event.dataTransfer) {
      const data = event.dataTransfer.getData('text/plain');
      const parsed = parseInt(data, 10);
      if (!isNaN(parsed)) {
        fromIndex = parsed;
      }
    }

    if (fromIndex === null || fromIndex === targetIndex) {
      this.draggedItemIndex = null;
      return;
    }

    const newScores = [...scores];
    const draggedItem = newScores.splice(fromIndex, 1)[0];
    newScores.splice(targetIndex, 0, draggedItem);

    // Emite nova ordem para persistência
    this.orderChanged.emit(newScores);
    this.draggedItemIndex = null;
  }
}
