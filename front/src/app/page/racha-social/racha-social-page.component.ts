import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';

// PrimeNG
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { RippleModule } from 'primeng/ripple';
import { CheckboxModule } from 'primeng/checkbox';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';

import { RachaSocialItem } from './racha-social-item';
import Dexie, { Table } from 'dexie';

// Configuração do Banco de Dados IndexedDB
export class AppDatabase extends Dexie {
  items!: Table<RachaSocialItem, number>;

  constructor() {
    super('RachaSocialDB');
    this.version(1).stores({
      items: '++id, nome'
    });
  }
}

@Component({
  selector: 'app-racha-social',
  standalone: true,
  templateUrl: './racha-social-page.component.html',
  styleUrls: ['./racha-social-page.component.scss'],
  imports: [
    CommonModule, FormsModule, TableModule, DialogModule, ButtonModule,
    RippleModule, CheckboxModule, InputNumberModule, InputTextModule,
    ToastModule, InputGroupModule, InputGroupAddonModule
  ],
  providers: [MessageService]
})
export class RachaSocialPageComponent implements OnInit {
  private db = new AppDatabase();

  items: RachaSocialItem[] = [];
  selectedItems: RachaSocialItem[] = [];
  item: RachaSocialItem = this.createEmptyItem();
  itemDialog: boolean = false;

  resumo = {
    totalGasto: 0,
    totalParticipantes: 0,
    totalAdultos: 0,
    totalCriancas: 0,
    valorPorAdulto: 0
  };

  constructor(private messageService: MessageService) {}

  async ngOnInit(): Promise<void> {
    await this.loadFromIndexedDB();
  }

  // --- PERSISTÊNCIA ---
  async loadFromIndexedDB(): Promise<void> {
    this.items = await this.db.items.toArray();
    this.calcularRateio();
  }

  async saveItem(): Promise<void> {
    if (this.validateForm()) {
      try {
        // O Dexie.put insere ou atualiza se o ID já existir
        await this.db.items.put({ ...this.item });
        await this.loadFromIndexedDB();

        this.messageService.add({ severity: 'success', summary: 'Sucesso', detail: 'Participante salvo com sucesso' });
        this.itemDialog = false;
        this.item = this.createEmptyItem();
      } catch (error) {
        this.messageService.add({ severity: 'error', summary: 'Erro', detail: 'Erro ao acessar banco de dados local' });
      }
    }
  }

  async deleteSelectedItems(): Promise<void> {
    if (!this.selectedItems || this.selectedItems.length === 0) return;

    try {
      const ids = this.selectedItems.map(i => i.id).filter((id): id is number => id !== undefined);
      await this.db.items.bulkDelete(ids);

      this.selectedItems = [];
      await this.loadFromIndexedDB();
      this.messageService.add({ severity: 'success', summary: 'Sucesso', detail: 'Itens excluídos' });
    } catch (error) {
      console.error(error);
    }
  }

  async clearTable(): Promise<void> {
    await this.db.items.clear();
    this.items = [];
    this.selectedItems = [];
    this.resetResumo();
    this.messageService.add({ severity: 'info', summary: 'Tabela limpa', detail: 'Todos os registros foram removidos' });
  }

  // --- LÓGICA DE NEGÓCIO (Restaurada) ---
  calcularRateio(): void {
    let somaGastos = 0;
    let somaPesos = 0;
    let countAdultos = 0;
    let countCriancas = 0;

    this.items.forEach(item => {
      if (item.gastou && item.valorGasto) somaGastos += item.valorGasto;
      if (item.pagar) {
        const adultos = item.qtdeAdultos || 0;
        const criancas = item.qtdeCriancas || 0;
        const percentual = item.percentualCriancas || 50;
        countAdultos += adultos;
        countCriancas += criancas;
        somaPesos += adultos + (criancas * (percentual / 100));
      }
    });

    const valorPorCota = somaPesos > 0 ? somaGastos / somaPesos : 0;

    this.items.forEach(item => {
      const gastoRealizado = item.gastou && item.valorGasto ? item.valorGasto : 0;
      let devePagar = 0;

      if (item.pagar) {
        const peso = (item.qtdeAdultos || 0) + ((item.qtdeCriancas || 0) * ((item.percentualCriancas || 50) / 100));
        devePagar = peso * valorPorCota;
      }

      const saldo = gastoRealizado - devePagar;
      item.haReceber = saldo > 0.01 ? saldo : 0;
      item.haPagar = saldo < -0.01 ? Math.abs(saldo) : 0;
    });

    this.resumo = {
      totalGasto: somaGastos,
      totalParticipantes: this.items.length,
      totalAdultos: countAdultos,
      totalCriancas: countCriancas,
      valorPorAdulto: valorPorCota
    };
  }

  validateForm(): boolean {
    if (!this.item.nome?.trim()) {
      this.messageService.add({ severity: 'error', summary: 'Erro', detail: 'Informe o nome' });
      return false;
    }
    if (this.item.gastou && (!this.item.valorGasto || this.item.valorGasto <= 0)) {
      this.messageService.add({ severity: 'error', summary: 'Erro', detail: 'Informe o valor gasto' });
      return false;
    }
    return true;
  }

  // --- UTILITÁRIOS ---
  openNew(): void {
    this.item = this.createEmptyItem();
    this.itemDialog = true;
  }

  hideDialog(): void {
    this.itemDialog = false;
  }

  resetResumo(): void {
    this.resumo = { totalGasto: 0, totalParticipantes: 0, totalAdultos: 0, totalCriancas: 0, valorPorAdulto: 0 };
  }

  createEmptyItem(): RachaSocialItem {
    return {
      nome: '', email: '', gastou: false, valorGasto: null, pagar: true,
      qtdeAdultos: 1, qtdeCriancas: 0, percentualCriancas: 50, haReceber: 0, haPagar: 0
    };
  }

  onPagarChange(): void {
    if (!this.item.pagar) {
      this.item.qtdeAdultos = null;
      this.item.qtdeCriancas = null;
    } else {
      this.item.qtdeAdultos = 1;
    }
  }

  onGastouChange(): void {
    if (!this.item.gastou) this.item.valorGasto = null;
  }

  onCriancasChange(): void {
    if (this.item.qtdeCriancas && this.item.qtdeCriancas > 0 && !this.item.percentualCriancas) {
      this.item.percentualCriancas = 50;
    }
  }
}
