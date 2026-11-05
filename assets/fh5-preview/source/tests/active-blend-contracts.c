#include "../shim/d3d12.c"
static unsigned checks;
#define CHECK(x) do { checks++; if(!(x)){printf("ACTIVE_BLEND_FAIL line=%u\n",__LINE__);return 1;} }while(0)
static void put32(unsigned char *p,unsigned value){memcpy(p,&value,4);}
static size_t signature(unsigned char *bytes,unsigned mask,unsigned width,unsigned stage)
{
    memset(bytes,0,512);memcpy(bytes,"DXBC",4);put32(bytes+28,2);put32(bytes+32,40);put32(bytes+36,52);
    memcpy(bytes+40,"SHDR",4);put32(bytes+44,4);put32(bytes+48,stage<<16);
    memcpy(bytes+52,width==32?"OSG1":width==28?"OSG5":"OSGN",4);
    unsigned count=0;for(unsigned i=0;i<8;i++)if(mask&(1u<<i))count++;
    unsigned data_size=8+count*width+10;put32(bytes+56,data_size);
    unsigned char *data=bytes+60;put32(data,count);put32(data+4,8);
    unsigned row=0;for(unsigned i=0;i<8;i++)if(mask&(1u<<i)){
        unsigned char *e=data+8+row++*width+(width==24?0:4);
        put32(e,8+count*width);put32(e+4,i);put32(e+8,64);put32(e+12,3);put32(e+16,i);e[20]=15;e[21]=15;
    }
    memcpy(data+8+count*width,"SV_Target",10);size_t size=60+data_size;put32(bytes+24,(unsigned)size);return size;
}
static size_t append(unsigned char *bytes,size_t at,UINT type,const void *value,size_t size,size_t align)
{
    put32(bytes+at,type);size_t inner=(at+4+align-1)&~(align-1);memcpy(bytes+inner,value,size);return(inner+size+7)&~(size_t)7;
}
int main(void)
{
    unsigned char shader[512],saved_shader[512];D3D12_GRAPHICS_PIPELINE_STATE_DESC d={0},copy,expected,saved;Fixups fx;
    timestamp_only=append_only=1;fh5_active_blend=1;
    d.NumRenderTargets=1;d.RTVFormats[0]=DXGI_FORMAT_R8G8B8A8_UNORM;
    D3D12_RENDER_TARGET_BLEND_DESC *b=&d.BlendState.RenderTarget[0];
    b->BlendEnable=TRUE;b->SrcBlend=D3D12_BLEND_ONE;b->DestBlend=D3D12_BLEND_SRC1_COLOR;
    b->BlendOp=D3D12_BLEND_OP_ADD;b->SrcBlendAlpha=D3D12_BLEND_INV_SRC1_ALPHA;b->DestBlendAlpha=D3D12_BLEND_ZERO;
    b->BlendOpAlpha=D3D12_BLEND_OP_REV_SUBTRACT;b->RenderTargetWriteMask=5;
    d.SampleMask=0xa5a5;d.RasterizerState.DepthBias=77;d.DepthStencilState.DepthFunc=D3D12_COMPARISON_FUNC_EQUAL;
    for(unsigned width=24;width<=32;width+=4)for(unsigned mask=0;mask<256;mask++){
        d.PS=(D3D12_SHADER_BYTECODE){shader,signature(shader,mask,width,0)};saved=d;memcpy(saved_shader,shader,512);
        BOOL change=(mask&1)&&mask!=3;
        CHECK((fix_graphics_desc(&d,&copy,&fx)==&copy)==change);
        if(change){expected=d;expected.BlendState.RenderTarget[0].DestBlend=D3D12_BLEND_SRC_COLOR;expected.BlendState.RenderTarget[0].SrcBlendAlpha=D3D12_BLEND_INV_SRC_ALPHA;CHECK(!memcmp(&copy,&expected,sizeof copy));}
        CHECK(!memcmp(&d,&saved,sizeof d));CHECK(!memcmp(shader,saved_shader,512));free_fixups(&fx);
    }
    d.PS=(D3D12_SHADER_BYTECODE){shader,signature(shader,1,32,0)};
    for(unsigned field=0;field<4;field++)for(unsigned factor=1;factor<=19;factor++){
        D3D12_BLEND_DESC blend=d.BlendState;
        D3D12_BLEND *fields[]={&blend.RenderTarget[0].SrcBlend,&blend.RenderTarget[0].DestBlend,&blend.RenderTarget[0].SrcBlendAlpha,&blend.RenderTarget[0].DestBlendAlpha};
        blend.RenderTarget[0].SrcBlend=D3D12_BLEND_ONE;blend.RenderTarget[0].DestBlend=D3D12_BLEND_ZERO;blend.RenderTarget[0].SrcBlendAlpha=D3D12_BLEND_ONE;blend.RenderTarget[0].DestBlendAlpha=D3D12_BLEND_ZERO;
        *fields[field]=(D3D12_BLEND)factor;D3D12_BLEND_DESC before=blend;
        CHECK(fix_active_blend(&blend,1,d.RTVFormats,d.PS,0)==is_src1((D3D12_BLEND)factor));
        *fields[field]=(D3D12_BLEND)factor;CHECK(!memcmp(&blend,&before,sizeof blend));
    }
    // Unknown, malformed, missing or non-pixel signatures stay untouched.
    for(unsigned kind=0;kind<6;kind++){
        d.PS=(D3D12_SHADER_BYTECODE){shader,signature(shader,1,32,kind==0?1:0)};
        if(kind==1)shader[0]='?';
        if(kind==2)d.PS.BytecodeLength=20;
        if(kind==3)put32(shader+64,0xffffffff);
        if(kind==4)put32(shader+60+8+4,511);
        if(kind==5)d.PS.pShaderBytecode=NULL;
        CHECK(fix_graphics_desc(&d,&copy,&fx)==&d);free_fixups(&fx);
    }
    d.PS=(D3D12_SHADER_BYTECODE){shader,signature(shader,1,32,0)};
    fh5_active_blend=0;CHECK(fix_graphics_desc(&d,&copy,&fx)==&d);free_fixups(&fx);fh5_active_blend=1;
    saved=d;
    for(unsigned kind=0;kind<5;kind++){
        d=saved;if(kind==0)d.NumRenderTargets=0;if(kind==1)d.NumRenderTargets=9;
        if(kind==2)d.RTVFormats[0]=DXGI_FORMAT_UNKNOWN;if(kind==3)d.BlendState.RenderTarget[0].BlendEnable=FALSE;if(kind==4)d.BlendState.RenderTarget[0].LogicOpEnable=TRUE;
        CHECK(fix_graphics_desc(&d,&copy,&fx)==&d);free_fixups(&fx);
    }
    // Independent states change only active enabled targets; common RT0 state
    // must also work when only a later render target has a format.
    d=saved;d.NumRenderTargets=3;d.RTVFormats[1]=DXGI_FORMAT_R8G8B8A8_UNORM;d.RTVFormats[2]=DXGI_FORMAT_UNKNOWN;
    d.BlendState.IndependentBlendEnable=TRUE;d.BlendState.RenderTarget[1]=*b;d.BlendState.RenderTarget[1].BlendEnable=FALSE;d.BlendState.RenderTarget[2]=*b;
    CHECK(fix_graphics_desc(&d,&copy,&fx)==&copy);CHECK(!memcmp(&copy.BlendState.RenderTarget[1],&d.BlendState.RenderTarget[1],7*sizeof(*b)));free_fixups(&fx);
    d.RTVFormats[0]=DXGI_FORMAT_UNKNOWN;CHECK(fix_graphics_desc(&d,&copy,&fx)==&d);free_fixups(&fx);
    d.BlendState.IndependentBlendEnable=FALSE;CHECK(fix_graphics_desc(&d,&copy,&fx)==&copy);free_fixups(&fx);
    // Direct and stream paths produce identical blend state; all other bytes
    // and caller-owned storage remain unchanged. Duplicate/trailing streams refuse.
    d=saved;CHECK(fix_graphics_desc(&d,&copy,&fx)==&copy);expected=copy;free_fixups(&fx);
    unsigned char bytes[640]={0},original[640];struct D3D12_RT_FORMAT_ARRAY formats={{DXGI_FORMAT_R8G8B8A8_UNORM},1};
    size_t size=append(bytes,0,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_SAMPLE_MASK,&d.SampleMask,4,4);
    size=append(bytes,size,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_PS,&d.PS,sizeof d.PS,8);
    size_t blend_at=size+4;size=append(bytes,size,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_BLEND,&d.BlendState,sizeof d.BlendState,4);
    size=append(bytes,size,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_RENDER_TARGET_FORMATS,&formats,sizeof formats,4);memcpy(original,bytes,sizeof bytes);
    D3D12_PIPELINE_STATE_STREAM_DESC in={size,bytes},out;
    CHECK(rewrite_stream(&in,&out,&fx));CHECK(out.SizeInBytes==size);
    CHECK(!memcmp((char*)out.pPipelineStateSubobjectStream+blend_at,&expected.BlendState,sizeof d.BlendState));
    memcpy((char*)out.pPipelineStateSubobjectStream+blend_at,&d.BlendState,sizeof d.BlendState);
    CHECK(!memcmp(out.pPipelineStateSubobjectStream,bytes,size));CHECK(!memcmp(bytes,original,sizeof bytes));free_fixups(&fx);
    fh5_active_blend=0;CHECK(!rewrite_stream(&in,&out,&fx));free_fixups(&fx);fh5_active_blend=1;
    in.SizeInBytes=size+1;CHECK(!rewrite_stream(&in,&out,&fx));free_fixups(&fx);
    in.SizeInBytes=append(bytes,size,D3D12_PIPELINE_STATE_SUBOBJECT_TYPE_PS,&d.PS,sizeof d.PS,8);CHECK(!rewrite_stream(&in,&out,&fx));free_fixups(&fx);
    printf("ACTIVE_BLEND_CONTRACT_OK checks=%u genuine_dual_source_and_unknowns_preserved=1 caller_and_shader_writes=0\n",checks);return 0;
}
