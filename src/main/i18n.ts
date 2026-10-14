/**
 * The few texts the main process shows itself: tray menu, tray balloon and file dialogs.
 * Everything else is translated in the renderer (src/renderer/src/i18n).
 */
import type { Locale } from '@shared/locales'

export interface MainTexts {
  trayIsolating: string // {game}
  trayNotIsolating: string
  trayOpen: string
  trayStop: string
  traySettings: string
  trayQuit: string
  balloonTitle: string
  balloonIsolating: string
  balloonIdle: string
  pickExeTitle: string
  pickExeFilter: string
  exportTitle: string
  exportFilter: string
}

const texts: Record<Locale, MainTexts> = {
  en: {
    trayIsolating: 'Isolating {game}',
    trayNotIsolating: 'Not isolating',
    trayOpen: 'Open InputSplit',
    trayStop: 'Stop isolation',
    traySettings: 'Settings',
    trayQuit: 'Quit InputSplit',
    balloonTitle: 'InputSplit is still running',
    balloonIsolating:
      'The game stays isolated. Use the tray icon to open InputSplit or stop isolation.',
    balloonIdle: 'InputSplit keeps running in the notification area.',
    pickExeTitle: 'Choose the game executable',
    pickExeFilter: 'Applications',
    exportTitle: 'Export diagnostics',
    exportFilter: 'Text',
  },
  uk: {
    trayIsolating: 'Ізоляція: {game}',
    trayNotIsolating: 'Ізоляцію вимкнено',
    trayOpen: 'Відкрити InputSplit',
    trayStop: 'Зупинити ізоляцію',
    traySettings: 'Налаштування',
    trayQuit: 'Вийти з InputSplit',
    balloonTitle: 'InputSplit досі працює',
    balloonIsolating:
      'Гра залишається ізольованою. Відкрийте InputSplit або зупиніть ізоляцію через значок у треї.',
    balloonIdle: 'InputSplit продовжує працювати в області сповіщень.',
    pickExeTitle: 'Виберіть виконуваний файл гри',
    pickExeFilter: 'Програми',
    exportTitle: 'Експорт діагностики',
    exportFilter: 'Текст',
  },
  ru: {
    trayIsolating: 'Изоляция: {game}',
    trayNotIsolating: 'Изоляция выключена',
    trayOpen: 'Открыть InputSplit',
    trayStop: 'Остановить изоляцию',
    traySettings: 'Настройки',
    trayQuit: 'Выйти из InputSplit',
    balloonTitle: 'InputSplit всё ещё работает',
    balloonIsolating:
      'Игра остаётся изолированной. Откройте InputSplit или остановите изоляцию через значок в трее.',
    balloonIdle: 'InputSplit продолжает работать в области уведомлений.',
    pickExeTitle: 'Выберите исполняемый файл игры',
    pickExeFilter: 'Программы',
    exportTitle: 'Экспорт диагностики',
    exportFilter: 'Текст',
  },
  es: {
    trayIsolating: 'Aislando {game}',
    trayNotIsolating: 'Sin aislamiento',
    trayOpen: 'Abrir InputSplit',
    trayStop: 'Detener aislamiento',
    traySettings: 'Ajustes',
    trayQuit: 'Salir de InputSplit',
    balloonTitle: 'InputSplit sigue en ejecución',
    balloonIsolating:
      'El juego sigue aislado. Usa el icono de la bandeja para abrir InputSplit o detener el aislamiento.',
    balloonIdle: 'InputSplit sigue funcionando en el área de notificaciones.',
    pickExeTitle: 'Elige el ejecutable del juego',
    pickExeFilter: 'Aplicaciones',
    exportTitle: 'Exportar diagnóstico',
    exportFilter: 'Texto',
  },
  de: {
    trayIsolating: '{game} wird isoliert',
    trayNotIsolating: 'Keine Isolierung aktiv',
    trayOpen: 'InputSplit öffnen',
    trayStop: 'Isolierung beenden',
    traySettings: 'Einstellungen',
    trayQuit: 'InputSplit beenden',
    balloonTitle: 'InputSplit läuft weiter',
    balloonIsolating:
      'Das Spiel bleibt isoliert. Über das Tray-Symbol öffnest du InputSplit oder beendest die Isolierung.',
    balloonIdle: 'InputSplit läuft im Infobereich weiter.',
    pickExeTitle: 'Programmdatei des Spiels auswählen',
    pickExeFilter: 'Programme',
    exportTitle: 'Diagnose exportieren',
    exportFilter: 'Text',
  },
  fr: {
    trayIsolating: 'Isolation de {game}',
    trayNotIsolating: 'Aucune isolation',
    trayOpen: 'Ouvrir InputSplit',
    trayStop: "Arrêter l'isolation",
    traySettings: 'Paramètres',
    trayQuit: 'Quitter InputSplit',
    balloonTitle: 'InputSplit est toujours actif',
    balloonIsolating:
      "Le jeu reste isolé. Utilisez l'icône de la zone de notification pour ouvrir InputSplit ou arrêter l'isolation.",
    balloonIdle: 'InputSplit continue de fonctionner dans la zone de notification.',
    pickExeTitle: "Choisir l'exécutable du jeu",
    pickExeFilter: 'Applications',
    exportTitle: 'Exporter le diagnostic',
    exportFilter: 'Texte',
  },
  'pt-BR': {
    trayIsolating: 'Isolando {game}',
    trayNotIsolating: 'Sem isolamento',
    trayOpen: 'Abrir o InputSplit',
    trayStop: 'Parar isolamento',
    traySettings: 'Configurações',
    trayQuit: 'Sair do InputSplit',
    balloonTitle: 'O InputSplit continua em execução',
    balloonIsolating:
      'O jogo continua isolado. Use o ícone da bandeja para abrir o InputSplit ou parar o isolamento.',
    balloonIdle: 'O InputSplit continua rodando na área de notificação.',
    pickExeTitle: 'Escolha o executável do jogo',
    pickExeFilter: 'Aplicativos',
    exportTitle: 'Exportar diagnóstico',
    exportFilter: 'Texto',
  },
  pl: {
    trayIsolating: 'Izolowanie: {game}',
    trayNotIsolating: 'Izolacja wyłączona',
    trayOpen: 'Otwórz InputSplit',
    trayStop: 'Zatrzymaj izolację',
    traySettings: 'Ustawienia',
    trayQuit: 'Zamknij InputSplit',
    balloonTitle: 'InputSplit nadal działa',
    balloonIsolating:
      'Gra pozostaje izolowana. Użyj ikony w zasobniku, aby otworzyć InputSplit lub zatrzymać izolację.',
    balloonIdle: 'InputSplit nadal działa w obszarze powiadomień.',
    pickExeTitle: 'Wybierz plik wykonywalny gry',
    pickExeFilter: 'Aplikacje',
    exportTitle: 'Eksportuj diagnostykę',
    exportFilter: 'Tekst',
  },
  tr: {
    trayIsolating: '{game} yalıtılıyor',
    trayNotIsolating: 'Yalıtım kapalı',
    trayOpen: "InputSplit'i aç",
    trayStop: 'Yalıtımı durdur',
    traySettings: 'Ayarlar',
    trayQuit: "InputSplit'ten çık",
    balloonTitle: 'InputSplit hâlâ çalışıyor',
    balloonIsolating:
      "Oyun yalıtılmış kalıyor. InputSplit'i açmak veya yalıtımı durdurmak için tepsi simgesini kullanın.",
    balloonIdle: 'InputSplit bildirim alanında çalışmaya devam ediyor.',
    pickExeTitle: 'Oyunun çalıştırılabilir dosyasını seçin',
    pickExeFilter: 'Uygulamalar',
    exportTitle: 'Tanılamayı dışa aktar',
    exportFilter: 'Metin',
  },
  'zh-CN': {
    trayIsolating: '正在隔离 {game}',
    trayNotIsolating: '未在隔离',
    trayOpen: '打开 InputSplit',
    trayStop: '停止隔离',
    traySettings: '设置',
    trayQuit: '退出 InputSplit',
    balloonTitle: 'InputSplit 仍在运行',
    balloonIsolating: '游戏仍处于隔离状态。可通过托盘图标打开 InputSplit 或停止隔离。',
    balloonIdle: 'InputSplit 会继续在通知区域运行。',
    pickExeTitle: '选择游戏的可执行文件',
    pickExeFilter: '应用程序',
    exportTitle: '导出诊断信息',
    exportFilter: '文本',
  },
  ja: {
    trayIsolating: '{game} を分離中',
    trayNotIsolating: '分離していません',
    trayOpen: 'InputSplit を開く',
    trayStop: '分離を停止',
    traySettings: '設定',
    trayQuit: 'InputSplit を終了',
    balloonTitle: 'InputSplit は実行中です',
    balloonIsolating:
      'ゲームは分離されたままです。トレイアイコンから InputSplit を開くか、分離を停止できます。',
    balloonIdle: 'InputSplit は通知領域で動作し続けます。',
    pickExeTitle: 'ゲームの実行ファイルを選択',
    pickExeFilter: 'アプリケーション',
    exportTitle: '診断情報をエクスポート',
    exportFilter: 'テキスト',
  },
}

export function mainTexts(locale: Locale): MainTexts {
  return texts[locale]
}
