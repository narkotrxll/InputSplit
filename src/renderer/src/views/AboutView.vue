<script setup lang="ts">
import { BookOpen, Bug, Code, Coffee } from '@lucide/vue'
import LogoMark from '../components/LogoMark.vue'
import PageHeader from '../components/PageHeader.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCallout from '../components/ui/UiCallout.vue'
import UiCard from '../components/ui/UiCard.vue'
import { call } from '../api'
import { useBackendStore } from '../stores/backend'
import { useUiStore } from '../stores/ui'

const backend = useBackendStore()
const ui = useUiStore()
const credits = ['noFocusLoss', 'protoInput', 'minHook', 'json', 'stack'] as const
</script>

<template>
  <div>
    <PageHeader :title="$t('about.title')" />
    <div class="flex max-w-3xl flex-col gap-4">
      <section class="flex items-start gap-5 rounded-2xl border border-line bg-surface p-6">
        <LogoMark :size="56" />
        <div class="min-w-0 flex-1">
          <h2 class="text-[20px] font-semibold tracking-[-0.02em] text-text">InputSplit</h2>
          <p class="text-[12.5px] text-text-faint">
            {{ $t('about.version', { version: backend.info?.version ?? '—' }) }}
          </p>
          <p class="mt-3 text-[13.5px] leading-relaxed text-text-muted">
            {{ $t('about.description') }}
          </p>
          <p class="mt-2 text-[12.5px] text-text-faint">{{ $t('about.license') }}</p>
          <div class="mt-4 flex flex-wrap gap-2">
            <UiButton :icon="Code" @click="call('app:openExternal', 'repository')">{{
              $t('about.repository')
            }}</UiButton>
            <UiButton :icon="Bug" @click="ui.reportOpen = true">{{ $t('report.button') }}</UiButton>
            <UiButton :icon="BookOpen" @click="call('app:openExternal', 'docs')">{{
              $t('about.docs')
            }}</UiButton>
            <UiButton :icon="Coffee" @click="call('app:openExternal', 'coffee')">{{
              $t('about.coffee')
            }}</UiButton>
          </div>
        </div>
      </section>

      <UiCard :title="$t('about.howItWorks')">
        <p class="text-[13.5px] leading-relaxed text-text-muted">
          {{ $t('about.howItWorksBody') }}
        </p>
      </UiCard>

      <UiCallout tone="warning" :title="$t('about.risk')">
        {{ $t('about.riskBody') }}
      </UiCallout>

      <UiCard :title="$t('about.credits')">
        <ul class="flex flex-col gap-2 text-[13px] text-text-muted">
          <li v-for="item in credits" :key="item" class="flex gap-2">
            <span class="mt-2 size-1 shrink-0 rounded-full bg-text-faint" />{{
              $t(`about.creditsItems.${item}`)
            }}
          </li>
        </ul>
      </UiCard>

      <UiCard :title="$t('about.technical')">
        <dl class="grid grid-cols-[180px_1fr] gap-y-2 text-[13px]">
          <dt class="text-text-faint">{{ $t('diagnostics.appVersion') }}</dt>
          <dd class="selectable font-mono text-text">{{ backend.info?.version }}</dd>
          <dt class="text-text-faint">{{ $t('diagnostics.electron') }}</dt>
          <dd class="selectable font-mono text-text">
            {{ backend.info?.electron }} (Chromium {{ backend.info?.chrome }})
          </dd>
          <dt class="text-text-faint">{{ $t('diagnostics.helperVersion') }}</dt>
          <dd class="selectable font-mono text-text">{{ backend.state?.helperVersion ?? '—' }}</dd>
          <dt class="text-text-faint">{{ $t('diagnostics.windowsBuild') }}</dt>
          <dd class="selectable font-mono text-text">{{ backend.state?.windowsBuild ?? '—' }}</dd>
        </dl>
      </UiCard>
    </div>
  </div>
</template>
