<script setup lang="ts">
import { Bug, ShieldCheck } from '@lucide/vue'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { call, errorCode } from '../api'
import { errorText } from '../i18n'
import { useUiStore } from '../stores/ui'
import UiButton from './ui/UiButton.vue'
import UiDialog from './ui/UiDialog.vue'

const { t } = useI18n()
const ui = useUiStore()
const busy = ref(false)
const error = ref<string | null>(null)

async function create(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const { fileName } = await call('diagnostics:report')
    ui.reportOpen = false
    ui.toast(
      { tone: 'success', title: t('report.done'), body: t('report.doneBody', { file: fileName }) },
      9000,
    )
  } catch (e) {
    error.value = errorText(errorCode(e), (e as Error).message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiDialog v-model:open="ui.reportOpen" :title="$t('report.title')" width="md">
    <div class="flex flex-col gap-3 text-[13.5px] leading-relaxed text-text-muted">
      <p>{{ $t('report.body') }}</p>
      <p class="flex gap-2.5 rounded-lg border border-line bg-bg-subtle px-3 py-2.5 text-[12.5px]">
        <ShieldCheck class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <span>{{ $t('report.contents') }}</span>
      </p>
      <p class="text-[12.5px]">{{ $t('report.account') }}</p>
      <p v-if="error" class="text-[12.5px] text-danger" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <UiButton variant="ghost" @click="ui.reportOpen = false">{{ $t('common.cancel') }}</UiButton>
      <UiButton variant="primary" :icon="Bug" :loading="busy" @click="create">{{
        $t('report.create')
      }}</UiButton>
    </template>
  </UiDialog>
</template>
