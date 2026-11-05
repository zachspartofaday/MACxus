/* Experimental FH5 compatibility policy, not a D3D12 equivalence claim.
 * Inspired by xvferxedd/fh5-d3dmetal-fix (GPL-3.0), commit 83944060.
 * Only the caller's copied blend state changes; shader bytes stay untouched. */
#ifndef MACXUS_ACTIVE_BLEND_H
#define MACXUS_ACTIVE_BLEND_H
#include "shader_signature.h"
static int fh5_active_blend;
static LONG active_blend_changes;
static D3D12_BLEND active_single_source(D3D12_BLEND factor)
{
    switch(factor) {
    case D3D12_BLEND_SRC1_COLOR:return D3D12_BLEND_SRC_COLOR;
    case D3D12_BLEND_INV_SRC1_COLOR:return D3D12_BLEND_INV_SRC_COLOR;
    case D3D12_BLEND_SRC1_ALPHA:return D3D12_BLEND_SRC_ALPHA;
    case D3D12_BLEND_INV_SRC1_ALPHA:return D3D12_BLEND_INV_SRC_ALPHA;
    default:return factor;
    }
}
static BOOL fix_active_blend(D3D12_BLEND_DESC *blend, UINT targets,
                             const DXGI_FORMAT *formats, D3D12_SHADER_BYTECODE ps,
                             unsigned stream)
{
    struct shader_outputs outputs;
    if(!fh5_active_blend || !blend || !formats || !targets || targets>8)return FALSE;
    D3D12_RENDER_TARGET_BLEND_DESC *first=&blend->RenderTarget[0];
    if(!first->BlendEnable || first->LogicOpEnable ||
       (!is_src1(first->SrcBlend) && !is_src1(first->DestBlend) &&
        !is_src1(first->SrcBlendAlpha) && !is_src1(first->DestBlendAlpha)))return FALSE;
    BOOL active=FALSE;
    for(UINT i=0;i<targets;i++)if(formats[i]!=DXGI_FORMAT_UNKNOWN)active=TRUE;
    if(!active || (blend->IndependentBlendEnable && formats[0]==DXGI_FORMAT_UNKNOWN))return FALSE;
    if(!shader_output_signature(ps.pShaderBytecode,ps.BytecodeLength,&outputs) ||
       !(outputs.mask&1) || (outputs.count==2 && outputs.mask==3))return FALSE;
    // Preserve disabled, absent and unused independent targets. With common
    // state, RT0's factors apply to all active targets and need changing once.
    for(UINT i=0;i<(blend->IndependentBlendEnable?targets:1);i++) {
        D3D12_RENDER_TARGET_BLEND_DESC *target=&blend->RenderTarget[i];
        if((blend->IndependentBlendEnable && formats[i]==DXGI_FORMAT_UNKNOWN) ||
           !target->BlendEnable || target->LogicOpEnable)continue;
        target->SrcBlend=active_single_source(target->SrcBlend);
        target->DestBlend=active_single_source(target->DestBlend);
        target->SrcBlendAlpha=active_single_source(target->SrcBlendAlpha);
        target->DestBlendAlpha=active_single_source(target->DestBlendAlpha);
    }
    LONG count=InterlockedIncrement(&active_blend_changes);
    if(count<=8 || !((DWORD)count&((DWORD)count-1)))
        observer_note(33,0,"active_blend_changed=1 stream=%u count=%lu targets=%u output_count=%u output_mask=%x shader_writes=0",stream,(unsigned long)count,targets,outputs.count,outputs.mask);
    return TRUE;
}
#endif
