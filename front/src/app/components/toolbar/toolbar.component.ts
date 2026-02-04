import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Select } from 'primeng/select'; // PrimeNG v18+

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule, Select],
  templateUrl: './toolbar.component.html',
  styleUrls: ['./toolbar.component.scss']
})
export class ToolbarComponent {
  @Input() zoomLevel: number = 1.5;
  @Input() currentKey: string = 'C';
  @Input() showPositions: boolean = true;
  @Input() instruments: { id: number, name: string, visible: boolean }[] = [];
  @Input() fileName: string = '';

  @Output() zoomIn = new EventEmitter<void>();
  @Output() zoomOut = new EventEmitter<void>();
  @Output() toggleSidebar = new EventEmitter<void>();
  @Output() togglePositions = new EventEmitter<void>();
  @Output() transposeToKey = new EventEmitter<string>(); // Vamos usar este evento
  @Output() saveSettings = new EventEmitter<void>();
  @Output() instrumentVisibilityChange = new EventEmitter<{ id: number, visible: boolean }>();
  @Output() toggleFullscreen = new EventEmitter<void>();

  // Lista ordenada conforme sua solicitação (Ciclo das Quintas / Enarmonia)
  keys = [
    { label: 'Dob Maior', value: 'Cb' },
    { label: 'Solb Maior', value: 'Gb' },
    { label: 'Reb Maior', value: 'Db' },
    { label: 'Lab Maior', value: 'Ab' },
    { label: 'Mib Maior', value: 'Eb' },
    { label: 'Sib Maior', value: 'Bb' },
    { label: 'Fa Maior', value: 'F' },
    { label: 'Do Maior', value: 'C' },
    { label: 'Sol Maior', value: 'G' },
    { label: 'Re Maior', value: 'D' },
    { label: 'La Maior', value: 'A' },
    { label: 'Mi Maior', value: 'E' },
    { label: 'Si Maior', value: 'B' },
    { label: 'Fa# Maior', value: 'F#' },
    { label: 'Do# Maior', value: 'C#' }
  ];

  onKeyChange(event: any) {
    // O evento do p-select retorna o valor diretamente ou via event.value dependendo da versão
    // Aqui garantimos que pegamos a string (ex: 'C#', 'Db')
    const selectedValue = event.value || event;
    this.transposeToKey.emit(selectedValue);
  }

  // Métodos auxiliares para os botões
  onInstrumentToggle(id: number, event: any): void {
    this.instrumentVisibilityChange.emit({ id, visible: event.target.checked });
  }

  onTogglePositions(): void {
    this.togglePositions.emit();
  }

  onSaveSettings(): void {
    this.saveSettings.emit();
  }
}
