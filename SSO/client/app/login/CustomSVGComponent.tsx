import React from "react";

interface PartialPropsInterface {
  SvgColor?: string;
  SvgWidth?: string;
  SvgHeight?: string;
  classname?: string;
  onClick?: React.MouseEventHandler<SVGSVGElement>
}

interface RequiredInterface {
  SVGIcon: React.FC<React.SVGProps<SVGSVGElement>>;
}

export default function CustomSVGComponent({
  SVGIcon,
  SvgColor,
  SvgWidth,
  SvgHeight,
  classname,
  onClick
}: Partial<PartialPropsInterface> & RequiredInterface) {
  return (
    <div className={classname} style={{ display: "inline-flex" }}>
      <SVGIcon 
        fill={SvgColor} 
        width={SvgWidth} 
        height={SvgHeight} 
        viewBox={`0 0 ${SvgWidth} ${SvgHeight}`} 
        preserveAspectRatio="xMidYMid meet"
        onClick={onClick}
      />
    </div> 
  );
}
